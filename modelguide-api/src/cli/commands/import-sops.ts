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
  deleteSop,
  findSopBySlug,
  forkFromTemplate,
  listTemplates,
  updateSop,
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

async function replaceInlineSop(
  orgId: string,
  sopId: string,
  item: SopItemInput,
  agentIds: string[],
): Promise<void> {
  const definition = await buildInlineDefinition(orgId, item);

  await updateSop(orgId, sopId, {
    name: item.name,
    description: item.description,
    definition,
    agentIds,
  });
  log.success(`Updated inline SOP in place: ${item.name}`);
}

export async function handleImportSops(
  orgId: string,
  items: SopItemInput[],
  options?: { registry?: IdRegistry; replace?: boolean },
): Promise<{
  created: number;
  existing: number;
  activated: number;
  replaced: number;
}> {
  const templates = await resolveTemplates();
  let created = 0;
  let existing = 0;
  let activated = 0;
  let replaced = 0;

  for (const item of items) {
    try {
      const agentIds = await requireAgentIds(
        orgId,
        item.agents,
        options?.registry,
      );

      // --replace: when an SOP with this slug already exists, update it in
      // place instead of deleting and recreating. This preserves the SOP's
      // UUID, so foreign keys pointing at it (eval_suites.sop_id, etc.)
      // survive the refresh. Template forks fall back to delete+recreate
      // because forkFromTemplate doesn't have an in-place variant — this
      // still cascades to eval_suites, so we log that loudly.
      if (options?.replace && item.slug) {
        const existingSop = await findSopBySlug(orgId, item.slug);
        if (existingSop) {
          if (item.templateSlug) {
            await deleteSop(orgId, existingSop.id);
            log.warn(
              `Re-forked template SOP: ${existingSop.name} (${item.slug}) — eval_suites linked to this SOP were cascade-deleted, re-run import-evals to restore them`,
            );
            replaced++;
          } else {
            await replaceInlineSop(orgId, existingSop.id, item, agentIds);
            if (options.registry) {
              options.registry.set("sop", item.slug, existingSop.id);
            }
            if (item.status === "active") {
              await activateSop(orgId, existingSop.id);
              activated++;
            }
            replaced++;
            continue;
          }
        }
      }

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

  return { created, existing, activated, replaced };
}

export function registerImportSopsCommand(program: Command): void {
  program
    .command("import-sops")
    .description("Import SOPs from YAML file")
    .requiredOption("--org <slug>", "Organization slug")
    .option(
      "--replace",
      "Delete and recreate SOPs whose slugs already exist (drops manual agent links)",
    )
    .argument("<file>", "YAML file path")
    .action(async (file: string, opts: { org: string; replace?: boolean }) => {
      const orgId = await resolveOrgId(opts.org);
      const data = loadYaml(file, sopsFileSchema);

      try {
        const result = await handleImportSops(orgId, data.sops, {
          replace: opts.replace,
        });
        const replacedSuffix = result.replaced
          ? `, ${result.replaced} replaced`
          : "";
        log.success(
          `SOPs: ${result.created} imported (${result.activated} active), ${result.existing} existing${replacedSuffix}`,
        );
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
