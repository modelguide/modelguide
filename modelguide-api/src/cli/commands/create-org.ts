/**
 * mg create-org — Create an organization.
 * Direct DB via forApp (no createOrganization service yet — #171).
 * Pattern from seed-org.ts (onConflictDoUpdate on slug).
 */

import { forApp } from "@db/rls";
import { organizations } from "@db/schema";
import type { Command } from "commander";
import { eq } from "drizzle-orm";
import { getErrorMessage } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { loadYaml } from "../lib/yaml-loader";
import { type OrgInput, orgSchema } from "../schemas/org.schema";

export async function handleCreateOrg(
  input: OrgInput,
  registry?: IdRegistry,
): Promise<{ id: string; slug: string; name: string }> {
  // Check if org already exists (upsert will update silently otherwise)
  const [existing] = await forApp((tx) =>
    tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, input.slug))
      .limit(1),
  );

  const orgValues = {
    name: input.name,
    slug: input.slug,
    settings: {
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.features ? { features: input.features } : {}),
    },
    demoEnabled: input.demoEnabled ?? false,
  };

  const [org] = await forApp(async (tx) => {
    return tx
      .insert(organizations)
      .values(orgValues)
      .onConflictDoUpdate({
        target: organizations.slug,
        set: {
          name: orgValues.name,
          settings: orgValues.settings,
          demoEnabled: orgValues.demoEnabled,
        },
      })
      .returning();
  });

  if (!org) {
    throw new Error(`Failed to create/find org ${input.slug}`);
  }

  if (existing) {
    log.warn(`Org "${input.slug}" already exists — updated settings`);
  }

  if (registry) {
    registry.set("org", org.slug, org.id);
  }

  return { id: org.id, slug: org.slug, name: org.name };
}

interface CreateOrgOpts {
  name?: string;
  slug?: string;
  timezone?: string;
  features?: string;
  demo?: boolean;
  from?: string;
}

export function registerCreateOrgCommand(program: Command): void {
  program
    .command("create-org")
    .description("Create an organization")
    .option("--name <name>", "Organization name")
    .option("--slug <slug>", "Organization slug")
    .option("--timezone <tz>", "Timezone")
    .option("--features <features>", "Comma-separated features")
    .option("--demo", "Enable demo mode")
    .option("--from <file>", "Load from YAML file")
    .action(async (opts: CreateOrgOpts) => {
      let input: OrgInput;

      if (opts.from) {
        input = loadYaml(opts.from, orgSchema);
      } else {
        try {
          input = orgSchema.parse({
            name: opts.name,
            slug: opts.slug,
            timezone: opts.timezone,
            features: opts.features?.split(","),
            demoEnabled: opts.demo ?? false,
          });
        } catch (err) {
          log.error(`Validation error: ${getErrorMessage(err)}`);
          process.exit(1);
        }
      }

      try {
        const org = await handleCreateOrg(input);
        log.success(`Created org: ${org.name} (${org.slug})`);
      } catch (err) {
        log.error(`Failed to create org: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
