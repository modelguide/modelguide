/**
 * mg add-users — Batch create users in an org.
 * Delegates to users.service.createUser.
 */

import { forOrg } from "@db/rls";
import { users as usersTable } from "@db/schema";
import { createUser } from "@features/users/users.service";
import type { Command } from "commander";
import { eq } from "drizzle-orm";
import { getErrorMessage, isDuplicateError } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { resolveInput } from "../lib/resolve-input";
import { resolveOrgId } from "../lib/resolve-org";
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
        if (registry) {
          const [existingUser] = await forOrg(orgId, (tx) =>
            tx
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(eq(usersTable.email, user.email))
              .limit(1),
          );
          if (existingUser) {
            registry.set("user", user.email, existingUser.id);
          }
        }
        log.info(`Found existing user: ${user.email}`);
        existing++;
      } else {
        throw err;
      }
    }
  }

  return { created, existing };
}

interface AddUsersOpts {
  org: string;
  from?: string;
}

export function registerAddUsersCommand(program: Command): void {
  program
    .command("add-users")
    .description("Batch create users in an organization")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--from <file>", "Load from YAML file")
    .argument("[entries...]", "Key=value user entries")
    .action(async (entries: string[], opts: AddUsersOpts) => {
      const orgId = await resolveOrgId(opts.org);
      const users = resolveInput<UserItemInput>(
        opts,
        entries,
        usersFileSchema,
        userItemSchema,
        "users",
      );

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
