/**
 * mg add-connectors — Batch create connectors in an org.
 *
 * Real connectors: delegates to connectors.service.createConnector
 * (auto-materializes tools from catalog).
 *
 * Mocked connectors (--mock or isMocked: true in YAML): upserts a
 * connectors_catalog entry, creates the connector instance, and inserts
 * connector_tools rows with mock_response populated from the YAML.
 * No TypeScript manifest is needed — executeTool() falls back to the DB.
 */

import { db } from "@db/client";
import { forOrg } from "@db/rls";
import { connectorTools, connectors, connectorsCatalog } from "@db/schema";
import {
  createConnector,
  listConnectors,
} from "@features/connectors/connectors.service";
import { createSecret } from "@features/secrets/secrets.service";
import { toolSlug } from "@lib/slugify";
import type { Command } from "commander";
import { eq } from "drizzle-orm";
import { getErrorMessage } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { parseKvArgs } from "../lib/parse-kv";
import { generatePlaceholder, promptSecret } from "../lib/prompt";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type ConnectorItemInput,
  type MockedConnectorInput,
  type RealConnectorInput,
  connectorItemSchema,
  connectorsFileSchema,
} from "../schemas/connectors.schema";

const PAGE_LIMIT = 100;

async function resolveCatalog(): Promise<
  Map<string, { id: string; slug: string }>
> {
  const catalog = await db
    .select({ id: connectorsCatalog.id, slug: connectorsCatalog.slug })
    .from(connectorsCatalog)
    .where(eq(connectorsCatalog.isActive, true));

  const map = new Map<string, { id: string; slug: string }>();
  for (const entry of catalog) {
    map.set(entry.slug, entry);
  }
  return map;
}

async function upsertMockedCatalogEntry(
  slug: string,
  name: string,
  iconUrl: string | undefined,
): Promise<string> {
  const [existing] = await db
    .select({ id: connectorsCatalog.id, iconUrl: connectorsCatalog.iconUrl })
    .from(connectorsCatalog)
    .where(eq(connectorsCatalog.slug, slug));

  if (existing) {
    if (iconUrl !== undefined && existing.iconUrl !== iconUrl) {
      await db
        .update(connectorsCatalog)
        .set({ iconUrl })
        .where(eq(connectorsCatalog.id, existing.id));
    }
    return existing.id;
  }

  const [created] = await db
    .insert(connectorsCatalog)
    .values({
      name,
      slug,
      connectorType: "api",
      iconUrl,
      isActive: true,
    })
    .returning({ id: connectorsCatalog.id });

  return created.id;
}

async function handleMockedConnector(
  orgId: string,
  item: MockedConnectorInput,
  options?: { registry?: IdRegistry },
): Promise<"created" | "existing"> {
  const { data: existingConnectors } = await listConnectors(orgId, {
    page: 1,
    pageSize: PAGE_LIMIT,
  });
  const existingConn = existingConnectors.find((c) => c.slug === item.slug);

  if (existingConn) {
    if (options?.registry) {
      options.registry.set("connector", item.slug, existingConn.id);
    }
    log.info(`Found existing connector: ${item.slug}`);
    return "existing";
  }

  // Derive a catalog slug from the connector slug (reuse or create one entry per slug)
  const catalogSlug = item.slug;
  const catalogId = await upsertMockedCatalogEntry(
    catalogSlug,
    item.name,
    item.iconUrl,
  );

  const [connector] = await forOrg(orgId, (tx) =>
    tx
      .insert(connectors)
      .values({
        organizationId: orgId,
        connectorCatalogId: catalogId,
        name: item.name,
        slug: item.slug,
        config: {},
        secrets: {},
      })
      .returning(),
  );

  await forOrg(orgId, (tx) =>
    tx.insert(connectorTools).values(
      item.tools.map((tool) => ({
        organizationId: orgId,
        connectorId: connector.id,
        name: tool.name,
        slug: toolSlug(tool.name),
        description: tool.description ?? null,
        toolSchema: tool.input_schema,
        mockResponse: tool.mock_response,
        isActive: true,
      })),
    ),
  );

  if (options?.registry) {
    options.registry.set("connector", item.slug, connector.id);
    if (!options.registry.has("catalogEntry", catalogSlug)) {
      options.registry.set("catalogEntry", catalogSlug, catalogId);
    }
  }

  log.success(
    `Created mocked connector: ${item.slug} (${item.tools.length} tools)`,
  );
  return "created";
}

async function handleRealConnector(
  orgId: string,
  item: RealConnectorInput,
  catalog: Map<string, { id: string; slug: string }>,
  options?: { skipSecrets?: boolean; registry?: IdRegistry },
): Promise<"created" | "existing"> {
  const { data: existingConnectors } = await listConnectors(orgId, {
    page: 1,
    pageSize: PAGE_LIMIT,
  });
  const existingConn = existingConnectors.find((c) => c.slug === item.slug);

  if (existingConn) {
    if (options?.registry) {
      options.registry.set("connector", item.slug, existingConn.id);
    }
    log.info(`Found existing connector: ${item.slug}`);
    return "existing";
  }

  const catalogEntry = catalog.get(item.catalogSlug);
  if (!catalogEntry) {
    throw new Error(
      `Catalog slug "${item.catalogSlug}" not found. Available: ${[...catalog.keys()].join(", ")}`,
    );
  }

  const secretsMap: Record<string, string> = {};
  for (const secretDef of item.secrets) {
    let value = secretDef.value;
    if (!value) {
      if (options?.skipSecrets) {
        value = generatePlaceholder(secretDef.name);
      } else {
        value = await promptSecret(secretDef.name);
      }
    }

    const secretResult = await createSecret(orgId, {
      name: secretDef.name,
      value,
      secretType: secretDef.type,
      scope: "connector",
    });
    secretsMap[secretDef.field] = secretResult.id;

    if (options?.registry) {
      options.registry.set("secret", secretDef.name, secretResult.id);
    }
  }

  const connector = await createConnector(orgId, {
    connectorCatalogId: catalogEntry.id,
    name: item.name,
    slug: item.slug,
    config: item.config,
    secrets: secretsMap,
  });

  if (options?.registry) {
    options.registry.set("connector", item.slug, connector.id);
    if (!options.registry.has("catalogEntry", item.catalogSlug)) {
      options.registry.set("catalogEntry", item.catalogSlug, catalogEntry.id);
    }
  }

  log.success(`Created connector: ${item.slug} (${item.catalogSlug})`);
  return "created";
}

export async function handleAddConnectors(
  orgId: string,
  items: ConnectorItemInput[],
  options?: { skipSecrets?: boolean; registry?: IdRegistry },
): Promise<{ created: number; existing: number }> {
  const catalog = await resolveCatalog();
  let created = 0;
  let existing = 0;

  for (const item of items) {
    const result =
      item.isMocked === true
        ? await handleMockedConnector(orgId, item, options)
        : await handleRealConnector(orgId, item, catalog, options);

    if (result === "created") created++;
    else existing++;
  }

  return { created, existing };
}

interface AddConnectorsOpts {
  org: string;
  from?: string;
}

export function registerAddConnectorsCommand(program: Command): void {
  program
    .command("add-connectors")
    .description("Batch create connectors in an organization")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--from <file>", "Load from YAML file")
    .argument("[entries...]", "Key=value connector entries")
    .action(async (entries: string[], opts: AddConnectorsOpts) => {
      const orgId = await resolveOrgId(opts.org);

      let items: ConnectorItemInput[];

      if (opts.from) {
        const data = loadYaml(opts.from, connectorsFileSchema);
        items = data.connectors;
      } else if (entries.length > 0) {
        const kvs = parseKvArgs(entries);
        items = kvs.map((kv) => {
          if (kv.config) {
            try {
              kv.config = JSON.parse(kv.config);
            } catch {
              throw new Error(`Invalid JSON in config value: ${kv.config}`);
            }
          }
          return connectorItemSchema.parse({
            ...kv,
            catalogSlug: kv.catalog ?? kv.catalogSlug,
          });
        });
      } else {
        log.error("Provide connector entries as args or --from <file>");
        process.exit(1);
      }

      try {
        const result = await handleAddConnectors(orgId, items);
        log.success(
          `Connectors: ${result.created} created, ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
