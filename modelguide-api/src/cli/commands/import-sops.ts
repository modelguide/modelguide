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
  setAssignedAgents,
} from "@features/sops/sops.service";
import type { SopSchema } from "@features/sops/sops.types";
import type { Command } from "commander";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import { type SopItemInput, sopsFileSchema } from "../schemas/sops.schema";

async function resolveTemplates(): Promise<Map<string, string>> {
  const { data } = await listTemplates({ page: 1, pageSize: 100 });
  const map = new Map<string, string>();
  for (const t of data) {
    map.set(t.slug, t.id);
  }
  return map;
}

function resolveAgentIds(
  agentSlugs: string[],
  registry?: IdRegistry,
): string[] {
  if (!registry) return [];
  return agentSlugs
    .filter((slug) => registry.has("agent", slug))
    .map((slug) => registry.get("agent", slug));
}

function resolveConnectorMapping(
  mapping: Record<string, string> | undefined,
  registry?: IdRegistry,
): Record<string, string> {
  if (!mapping) return {};
  const resolved: Record<string, string> = {};
  for (const [catalogSlug, connectorSlug] of Object.entries(mapping)) {
    if (registry?.has("connector", connectorSlug)) {
      resolved[catalogSlug] = registry.get("connector", connectorSlug);
    } else {
      resolved[catalogSlug] = connectorSlug;
    }
  }
  return resolved;
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
      let sopId: string;
      const agentIds = resolveAgentIds(item.agents, options?.registry);

      if (item.templateSlug) {
        // Template fork
        const templateId = templates.get(item.templateSlug);
        if (!templateId) {
          throw new Error(
            `SOP template "${item.templateSlug}" not found. Available: ${[...templates.keys()].join(", ")}`,
          );
        }

        const connectorMapping = resolveConnectorMapping(
          item.connectorMapping,
          options?.registry,
        );

        const sop = await forkFromTemplate(orgId, templateId, {
          name: item.name,
          slug: item.slug,
          connectorMapping,
          agentIds,
        });
        sopId = sop.id;
        log.success(
          `Forked SOP from template: ${item.name} (${item.templateSlug})`,
        );
      } else {
        // Inline SOP
        if (!item.steps || item.steps.length === 0) {
          throw new Error(
            `Inline SOP "${item.name}" must have at least one step`,
          );
        }

        const definition: SopSchema = {
          schemaVersion: 1,
          trigger: (item.trigger as SopSchema["trigger"]) ?? {
            type: "manual",
            config: {},
          },
          steps: item.steps.map((step, idx) => ({
            id: step.id,
            order: idx + 1,
            instruction: step.instruction,
            required: step.required,
            ...(step.tool
              ? {
                  tool: {
                    catalogSlug: step.tool.connectorSlug,
                    toolSlug: step.tool.toolSlug,
                  },
                }
              : {}),
          })),
          metadata: (item.metadata as SopSchema["metadata"]) ?? {},
        };

        const sop = await createSop(orgId, {
          name: item.name,
          slug: item.slug,
          description: item.description,
          definition,
          agentIds,
        });
        sopId = sop.id;
        log.success(`Created inline SOP: ${item.name}`);
      }

      if (options?.registry) {
        options.registry.set("sop", item.slug ?? item.name, sopId);
      }

      // Activate if requested
      if (item.status === "active") {
        await activateSop(orgId, sopId);
        activated++;
      }

      // Set agent assignments (in case agents weren't passed to create/fork)
      if (agentIds.length > 0) {
        await setAssignedAgents(orgId, sopId, agentIds);
      }

      created++;
    } catch (err) {
      const msg = (err as Error).message;
      if (
        msg.includes("duplicate") ||
        msg.includes("already exists") ||
        msg.includes("Already exists")
      ) {
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
    .action(async (file: string, opts) => {
      const orgId = await resolveOrgId(opts.org);
      const data = loadYaml(file, sopsFileSchema);

      try {
        const result = await handleImportSops(orgId, data.sops);
        log.success(
          `SOPs: ${result.created} imported (${result.activated} active), ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
