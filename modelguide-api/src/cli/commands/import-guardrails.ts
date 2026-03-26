/**
 * mg import-guardrails — Import guardrails from YAML.
 * Delegates to knowledge-base.service.createKnowledgeBase.
 */

import { createKnowledgeBase } from "@features/knowledge-base/knowledge-base.service";
import type { Command } from "commander";
import { getErrorMessage, isDuplicateError } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { requireAgentIds } from "../lib/resolve-agents";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type GuardrailItemInput,
  guardrailsFileSchema,
} from "../schemas/guardrails.schema";

export async function handleImportGuardrails(
  orgId: string,
  items: GuardrailItemInput[],
  options?: { registry?: IdRegistry },
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const item of items) {
    const agentIds = await requireAgentIds(
      orgId,
      item.agents,
      options?.registry,
    );

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
      if (isDuplicateError(err)) {
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
    .action(async (file: string, opts: { org: string }) => {
      const orgId = await resolveOrgId(opts.org);
      const data = loadYaml(file, guardrailsFileSchema);

      try {
        const result = await handleImportGuardrails(orgId, data.guardrails);
        log.success(
          `Guardrails: ${result.created} created, ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
