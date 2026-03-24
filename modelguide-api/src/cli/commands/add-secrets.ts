/**
 * mg add-secrets — Batch create secrets in an org.
 * Delegates to secrets.service.createSecret.
 * Values prompted interactively when not provided.
 */

import { createSecret } from "@features/secrets/secrets.service";
import type { Command } from "commander";
import { getErrorMessage, isDuplicateError } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { parseKvArgs } from "../lib/parse-kv";
import { generatePlaceholder, promptSecret } from "../lib/prompt";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type SecretItemInput,
  secretItemSchema,
  secretsFileSchema,
} from "../schemas/secrets.schema";

export async function handleAddSecrets(
  orgId: string,
  secrets: SecretItemInput[],
  options?: { skipSecrets?: boolean; registry?: IdRegistry },
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const secret of secrets) {
    let value = secret.value;
    if (!value) {
      if (options?.skipSecrets) {
        value = generatePlaceholder(secret.name);
      } else {
        value = await promptSecret(secret.name);
      }
    }

    try {
      const result = await createSecret(orgId, {
        name: secret.name,
        value,
        secretType: secret.type,
        scope: secret.scope,
      });
      if (options?.registry) {
        options.registry.set("secret", secret.name, result.id);
      }
      log.success(`Created secret: ${secret.name}`);
      created++;
    } catch (err) {
      if (isDuplicateError(err)) {
        log.info(`Found existing secret: ${secret.name}`);
        existing++;
      } else {
        throw err;
      }
    }
  }

  return { created, existing };
}

export function registerAddSecretsCommand(program: Command): void {
  program
    .command("add-secrets")
    .description("Batch create secrets in an organization")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--from <file>", "Load from YAML file")
    .argument("[entries...]", "Key=value secret entries")
    .action(async (entries: string[], opts) => {
      const orgId = await resolveOrgId(opts.org);

      let secrets: SecretItemInput[];

      if (opts.from) {
        const data = loadYaml(opts.from, secretsFileSchema);
        secrets = data.secrets;
      } else if (entries.length > 0) {
        const kvs = parseKvArgs(entries);
        secrets = kvs.map((kv) => secretItemSchema.parse(kv));
      } else {
        log.error("Provide secret entries as args or --from <file>");
        process.exit(1);
      }

      try {
        const result = await handleAddSecrets(orgId, secrets);
        log.success(
          `Secrets: ${result.created} created, ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
