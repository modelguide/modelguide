/**
 * mg add-users — Batch create users in an org.
 * Delegates to users.service.createUser.
 */

import { createUser } from "@features/users/users.service";
import type { Command } from "commander";
import { getErrorMessage, isDuplicateError } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { parseKvArgs } from "../lib/parse-kv";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type UserItemInput,
  userItemSchema,
  usersFileSchema,
} from "../schemas/users.schema";

export async function handleAddUsers(
  orgId: string,
  users: UserItemInput[],
  registry?: IdRegistry,
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const user of users) {
    try {
      const result = await createUser(orgId, {
        email: user.email,
        name: user.name,
        role: user.role,
      });
      if (registry) {
        registry.set("user", result.email, result.id);
      }
      log.success(`Created user: ${result.email} (${user.role})`);
      created++;
    } catch (err) {
      if (isDuplicateError(err)) {
        log.info(`Found existing user: ${user.email}`);
        existing++;
      } else {
        throw err;
      }
    }
  }

  return { created, existing };
}

export function registerAddUsersCommand(program: Command): void {
  program
    .command("add-users")
    .description("Batch create users in an organization")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--from <file>", "Load from YAML file")
    .argument("[entries...]", "Key=value user entries")
    .action(async (entries: string[], opts) => {
      const orgId = await resolveOrgId(opts.org);

      let users: UserItemInput[];

      if (opts.from) {
        const data = loadYaml(opts.from, usersFileSchema);
        users = data.users;
      } else if (entries.length > 0) {
        const kvs = parseKvArgs(entries);
        users = kvs.map((kv) => userItemSchema.parse(kv));
      } else {
        log.error("Provide user entries as args or --from <file>");
        process.exit(1);
      }

      try {
        const result = await handleAddUsers(orgId, users);
        log.success(
          `Users: ${result.created} created, ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
