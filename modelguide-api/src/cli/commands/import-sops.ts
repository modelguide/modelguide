/**
 * mg import-sops — Import SOPs from YAML.
 * Template fork: sops.service.forkFromTemplate
 * Inline: sops.service.createSop
 * Activate: sops.service.activateSop
 * Agent assignment: sops.service.setAssignedAgents
 */

import {
  activateSop,
  createSop,
  forkFromTemplate,
  listTemplates,
} from "@features/sops/sops.service";
import type { SopSchema, SopTrigger } from "@features/sops/sops.types";
import type { Command } from "commander";
import { getErrorMessage, isDuplicateError } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { requireAgentIds } from "../lib/resolve-agents";
import {
  resolveConnectorMappingIds,
  resolveConnectorToolReference,
} from "../lib/resolve-connectors";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import { type SopItemInput, sopsFileSchema } from "../schemas/sops.schema";

const PAGE_LIMIT = 100;

async function resolveTemplates(): Promise<Map<string, string>> {
  const { data } = await listTemplates({ page: 1, pageSize: PAGE_LIMIT });
  if (data.length === PAGE_LIMIT) {
    log.warn(`${PAGE_LIMIT}+ SOP templates found — some may be missing`);
  }
  const map = new Map<string, string>();
  for (const t of data) {
    map.set(t.slug, t.id);
  }
  return map;
}

async function buildInlineDefinition(
  orgId: string,
  item: SopItemInput,
): Promise<SopSchema> {
  if (!item.steps || item.steps.length === 0) {
    throw new Error(`Inline SOP "${item.name}" must have at least one step`);
  }

  const steps = await Promise.all(
    item.steps.map(async (step, idx) => ({
      id: step.id,
      order: idx + 1,
      instruction: step.instruction,
      required: step.required,
      ...(step.tool
        ? {
            tool: {
              connectorToolId: await resolveConnectorToolReference(
                orgId,
                step.tool.connectorSlug,
                step.tool.toolSlug,
              ),
            },
          }
        : {}),
    })),
  );

  return {
    schemaVersion: 1,
    trigger: (item.trigger as SopTrigger | undefined) ?? {
      type: "manual",
      config: {},
    },
    steps,
    metadata: item.metadata ?? {},
  };
}

async function importTemplateSop(
  orgId: string,
  item: SopItemInput,
  templates: Map<string, string>,
  agentIds: string[],
  registry?: IdRegistry,
): Promise<string> {
  const templateId = templates.get(item.templateSlug!);
  if (!templateId) {
    throw new Error(
      `SOP template "${item.templateSlug}" not found. Available: ${[...templates.keys()].join(", ")}`,
    );
  }

  const connectorMapping = await resolveConnectorMappingIds(
    orgId,
    item.connectorMapping,
    registry,
  );

  const sop = await forkFromTemplate(orgId, templateId, {
    name: item.name,
    slug: item.slug,
    connectorMapping,
    agentIds,
  });
  log.success(`Forked SOP from template: ${item.name} (${item.templateSlug})`);
  return sop.id;
}

async function importInlineSop(
  orgId: string,
  item: SopItemInput,
  agentIds: string[],
): Promise<string> {
  const definition = await buildInlineDefinition(orgId, item);

  const sop = await createSop(orgId, {
    name: item.name,
    slug: item.slug,
    description: item.description,
    definition,
    agentIds,
  });
  log.success(`Created inline SOP: ${item.name}`);
  return sop.id;
}

export async function handleImportSops(
  orgId: string,
  items: SopItemInput[],
  options?: { registry?: IdRegistry },
): Promise<{ created: number; existing: number; activated: number }> {
  const templates = await resolveTemplates();
  let created = 0;
  let existing = 0;
  let activated = 0;

  for (const item of items) {
    try {
      const agentIds = await requireAgentIds(
        orgId,
        item.agents,
        options?.registry,
      );

      const sopId = item.templateSlug
        ? await importTemplateSop(
            orgId,
            item,
            templates,
            agentIds,
            options?.registry,
          )
        : await importInlineSop(orgId, item, agentIds);

      if (options?.registry) {
        options.registry.set("sop", item.slug ?? item.name, sopId);
      }

      if (item.status === "active") {
        await activateSop(orgId, sopId);
        activated++;
      }

      created++;
    } catch (err) {
      if (isDuplicateError(err)) {
        log.info(`Found existing SOP: ${item.name}`);
        existing++;
      } else {
        throw err;
      }
    }
  }

  return { created, existing, activated };
}

export function registerImportSopsCommand(program: Command): void {
  program
    .command("import-sops")
    .description("Import SOPs from YAML file")
    .requiredOption("--org <slug>", "Organization slug")
    .argument("<file>", "YAML file path")
    .action(async (file: string, opts: { org: string }) => {
      const orgId = await resolveOrgId(opts.org);
      const data = loadYaml(file, sopsFileSchema);

      try {
        const result = await handleImportSops(orgId, data.sops);
        log.success(
          `SOPs: ${result.created} imported (${result.activated} active), ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
