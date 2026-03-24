/**
 * mg import-guardrails — Import guardrails from YAML.
 * Delegates to knowledge-base.service.createKnowledgeBase.
 */

import { createKnowledgeBase } from "@features/knowledge-base/knowledge-base.service";
import type { Command } from "commander";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type GuardrailItemInput,
  guardrailsFileSchema,
} from "../schemas/guardrails.schema";

function resolveAgentIds(
  agentSlugs: string[],
  registry?: IdRegistry,
): string[] {
  if (!registry) return [];
  return agentSlugs
    .filter((slug) => registry.has("agent", slug))
    .map((slug) => registry.get("agent", slug));
}

export async function handleImportGuardrails(
  orgId: string,
  items: GuardrailItemInput[],
  options?: { registry?: IdRegistry },
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const item of items) {
    const agentIds = resolveAgentIds(item.agents, options?.registry);

    try {
      const result = await createKnowledgeBase(orgId, {
        type: "guardrail",
        name: item.name,
        slug: item.slug,
        content: item.content,
        description: item.description,
        config: item.config,
        agentIds,
      });

      if (options?.registry) {
        options.registry.set("guardrail", item.slug ?? item.name, result.id);
      }

      log.success(`Created guardrail: ${item.name}`);
      created++;
    } catch (err) {
      const msg = (err as Error).message;
      if (
        msg.includes("duplicate") ||
        msg.includes("already exists") ||
        msg.includes("Already exists")
      ) {
        log.info(`Found existing guardrail: ${item.name}`);
        existing++;
      } else {
        throw err;
      }
    }
  }

  return { created, existing };
}

export function registerImportGuardrailsCommand(program: Command): void {
  program
    .command("import-guardrails")
    .description("Import guardrails from YAML file")
    .requiredOption("--org <slug>", "Organization slug")
    .argument("<file>", "YAML file path")
    .action(async (file: string, opts) => {
      const orgId = await resolveOrgId(opts.org);
      const data = loadYaml(file, guardrailsFileSchema);

      try {
        const result = await handleImportGuardrails(orgId, data.guardrails);
        log.success(
          `Guardrails: ${result.created} created, ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
