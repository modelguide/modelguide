/**
 * mg import-personas — Import simulation personas from YAML.
 *
 * Personas are org-scoped and override built-in personas when IDs conflict.
 * Idempotent: re-running skips existing personas by default.
 *
 * --replace: Update existing personas instead of skipping them.
 */

import { forOrg } from "@db/rls";
import { simulationPersonas } from "@db/schema";
import type { Command } from "commander";
import { and, eq, inArray } from "drizzle-orm";
import { getErrorMessage } from "../lib/errors";
import { log } from "../lib/logger";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type PersonaItemInput,
  personasFileSchema,
} from "../schemas/personas.schema";

// ============================================================================
// Result type
// ============================================================================

export interface ImportPersonasResult {
  created: number;
  skipped: number;
  replaced: number;
}

// ============================================================================
// Main handler
// ============================================================================

export async function handleImportPersonas(
  orgId: string,
  personas: PersonaItemInput[],
  options?: { replace?: boolean },
): Promise<ImportPersonasResult> {
  const result: ImportPersonasResult = {
    created: 0,
    skipped: 0,
    replaced: 0,
  };

  if (personas.length === 0) return result;

  await forOrg(orgId, async (tx) => {
    const slugs = personas.map((p) => p.id);

    const existingRows = await tx
      .select({ slug: simulationPersonas.slug })
      .from(simulationPersonas)
      .where(inArray(simulationPersonas.slug, slugs));
    const existingSlugs = new Set(existingRows.map((r) => r.slug));

    for (const persona of personas) {
      const values = {
        organizationId: orgId,
        slug: persona.id,
        name: persona.name,
        description: persona.description ?? null,
        systemPrompt: persona.system_prompt,
        traits: persona.traits,
        maxTurns: persona.max_turns ?? null,
        email: persona.email ?? null,
      };

      if (existingSlugs.has(persona.id)) {
        if (!options?.replace) {
          log.info(`Skipping existing persona: ${persona.id}`);
          result.skipped++;
          continue;
        }

        await tx
          .update(simulationPersonas)
          .set({
            name: values.name,
            description: values.description,
            systemPrompt: values.systemPrompt,
            traits: values.traits,
            maxTurns: values.maxTurns,
            email: values.email,
          })
          .where(
            and(
              eq(simulationPersonas.organizationId, orgId),
              eq(simulationPersonas.slug, persona.id),
            ),
          );

        log.info(`Replaced persona: ${persona.id}`);
        result.replaced++;
        continue;
      }

      await tx.insert(simulationPersonas).values(values);
      log.success(`Created persona: ${persona.id}`);
      result.created++;
    }
  });

  return result;
}

// ============================================================================
// Commander registration
// ============================================================================

export function registerImportPersonasCommand(program: Command): void {
  program
    .command("import-personas")
    .description("Import simulation personas from YAML file")
    .requiredOption("--org <slug>", "Organization slug")
    .option(
      "--replace",
      "Replace existing personas instead of skipping them",
      false,
    )
    .argument("<file>", "YAML file path")
    .action(async (file: string, opts: { org: string; replace: boolean }) => {
      try {
        const orgId = await resolveOrgId(opts.org);
        const data = loadYaml(file, personasFileSchema);

        const result = await handleImportPersonas(orgId, data.personas, {
          replace: opts.replace,
        });

        const parts = [
          `${result.created} created`,
          `${result.skipped} skipped`,
        ];
        if (result.replaced > 0) parts.push(`${result.replaced} replaced`);

        log.success(`Personas: ${parts.join(", ")}`);
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
