/**
 * mg add-connectors — Batch create connectors in an org.
 * Delegates to connectors.service.createConnector (auto-materializes tools).
 * Creates secrets for each connector's declared secret fields.
 */

import {
  createConnector,
  listCatalog,
  listConnectorTools,
} from "@features/connectors/connectors.service";
import { createSecret } from "@features/secrets/secrets.service";
import type { Command } from "commander";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { parseKvArgs } from "../lib/parse-kv";
import { promptSecret } from "../lib/prompt";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type ConnectorItemInput,
  connectorItemSchema,
  connectorsFileSchema,
} from "../schemas/connectors.schema";

async function resolveCatalog(): Promise<
  Map<string, { id: string; slug: string }>
> {
  const { data } = await listCatalog({ page: 1, pageSize: 100 });
  const map = new Map<string, { id: string; slug: string }>();
  for (const entry of data) {
    map.set(entry.slug, { id: entry.id, slug: entry.slug });
  }
  return map;
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
    const catalogEntry = catalog.get(item.catalogSlug);
    if (!catalogEntry) {
      throw new Error(
        `Catalog slug "${item.catalogSlug}" not found. Available: ${[...catalog.keys()].join(", ")}`,
      );
    }

    // Create secrets and build secretsMap
    const secretsMap: Record<string, string> = {};
    for (const secretDef of item.secrets) {
      let value = secretDef.value;
      if (!value) {
        if (options?.skipSecrets) {
          value = `placeholder_${secretDef.name.toLowerCase().replace(/\s+/g, "_")}`;
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

    try {
      const connector = await createConnector(orgId, {
        connectorCatalogId: catalogEntry.id,
        name: item.name,
        slug: item.slug,
        config: item.config,
        secrets: secretsMap,
      });

      // Count tools created
      const tools = await listConnectorTools(orgId, connector.id);

      if (options?.registry) {
        options.registry.set("connector", item.slug, connector.id);
        if (options.registry.has("catalogEntry", item.catalogSlug) === false) {
          options.registry.set(
            "catalogEntry",
            item.catalogSlug,
            catalogEntry.id,
          );
        }
      }

      log.success(
        `Created connector: ${item.slug} (${item.catalogSlug}, ${tools.length} tools)`,
      );
      created++;
    } catch (err) {
      const msg = (err as Error).message;
      if (
        msg.includes("duplicate") ||
        msg.includes("already exists") ||
        msg.includes("Already exists")
      ) {
        log.info(`Found existing connector: ${item.slug}`);
        existing++;
      } else {
        throw err;
      }
    }
  }

  return { created, existing };
}

export function registerAddConnectorsCommand(program: Command): void {
  program
    .command("add-connectors")
    .description("Batch create connectors in an organization")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--from <file>", "Load from YAML file")
    .argument("[entries...]", "Key=value connector entries")
    .action(async (entries: string[], opts) => {
      const orgId = await resolveOrgId(opts.org);

      let items: ConnectorItemInput[];

      if (opts.from) {
        const data = loadYaml(opts.from, connectorsFileSchema);
        items = data.connectors;
      } else if (entries.length > 0) {
        const kvs = parseKvArgs(entries);
        items = kvs.map((kv) => {
          // Parse JSON config if provided
          if (kv.config) {
            try {
              kv.config = JSON.parse(kv.config);
            } catch {
              // keep as-is
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
        log.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
