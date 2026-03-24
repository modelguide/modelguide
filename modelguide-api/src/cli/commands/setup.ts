/**
 * mg setup <dir> — Full org provisioning orchestrator.
 * Loads YAML files from directory, validates, executes pipeline in dependency order.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { IdRegistry } from "../lib/id-registry";
import { intro, log, outro, table } from "../lib/logger";
import { loadYaml } from "../lib/yaml-loader";
import type { AgentItemInput } from "../schemas/agents.schema";
import { agentsFileSchema } from "../schemas/agents.schema";
import type { ConnectorItemInput } from "../schemas/connectors.schema";
import { connectorsFileSchema } from "../schemas/connectors.schema";
import type { GuardrailItemInput } from "../schemas/guardrails.schema";
import { guardrailsFileSchema } from "../schemas/guardrails.schema";
import type { OrgInput } from "../schemas/org.schema";
import { orgSchema } from "../schemas/org.schema";
import type { SessionItemInput } from "../schemas/sessions.schema";
import { sessionsFileSchema } from "../schemas/sessions.schema";
import type { SopItemInput } from "../schemas/sops.schema";
import { sopsFileSchema } from "../schemas/sops.schema";
import type { UserItemInput } from "../schemas/users.schema";
import { usersFileSchema } from "../schemas/users.schema";
import { handleAddAgents } from "./add-agents";
import { handleAddConnectors } from "./add-connectors";
import { handleAddUsers } from "./add-users";
import { handleCompileAgents } from "./compile-agents";
import { handleCreateOrg } from "./create-org";
import { handleImportGuardrails } from "./import-guardrails";
import { handleImportSessions } from "./import-sessions";
import { handleImportSops } from "./import-sops";

interface SetupOptions {
  dryRun?: boolean;
  skipSecrets?: boolean;
  skipCompile?: boolean;
  skipSessions?: boolean;
}

interface SetupFiles {
  org: OrgInput;
  users?: { users: UserItemInput[] };
  connectors?: { connectors: ConnectorItemInput[] };
  agents?: { agents: AgentItemInput[] };
  sops?: { sops: SopItemInput[] };
  guardrails?: { guardrails: GuardrailItemInput[] };
  sessions?: { sessions: SessionItemInput[] };
}

function tryLoadYaml<S extends import("zod").ZodTypeAny>(
  dir: string,
  filename: string,
  schema: S,
): import("zod").output<S> | undefined {
  const filePath = path.join(dir, filename);
  if (!existsSync(filePath)) return undefined;
  return loadYaml(filePath, schema);
}

function loadSetupFiles(dir: string): SetupFiles {
  const orgPath = path.join(dir, "org.yaml");
  if (!existsSync(orgPath)) {
    throw new Error(`org.yaml is required in ${dir}`);
  }

  return {
    org: loadYaml(orgPath, orgSchema),
    users: tryLoadYaml(dir, "users.yaml", usersFileSchema),
    connectors: tryLoadYaml(dir, "connectors.yaml", connectorsFileSchema),
    agents: tryLoadYaml(dir, "agents.yaml", agentsFileSchema),
    sops: tryLoadYaml(dir, "sops.yaml", sopsFileSchema),
    guardrails: tryLoadYaml(dir, "guardrails.yaml", guardrailsFileSchema),
    sessions: tryLoadYaml(dir, "sessions.yaml", sessionsFileSchema),
  };
}

function printDryRun(files: SetupFiles): void {
  log.info("Dry-run plan:");
  log.step(`Org: ${files.org.name} (${files.org.slug})`);

  if (files.users) {
    log.step(`Users: ${files.users.users.length}`);
    for (const u of files.users.users) {
      log.info(`  - ${u.email} (${u.role})`);
    }
  }

  if (files.connectors) {
    log.step(`Connectors: ${files.connectors.connectors.length}`);
    for (const c of files.connectors.connectors) {
      log.info(`  - ${c.slug} (${c.catalogSlug})`);
    }
  }

  if (files.agents) {
    log.step(`Agents: ${files.agents.agents.length}`);
    for (const a of files.agents.agents) {
      log.info(`  - ${a.name} (${a.modality})`);
    }
  }

  if (files.sops) {
    log.step(`SOPs: ${files.sops.sops.length}`);
    for (const s of files.sops.sops) {
      log.info(
        `  - ${s.name} (${s.templateSlug ? `template: ${s.templateSlug}` : "inline"})`,
      );
    }
  }

  if (files.guardrails) {
    log.step(`Guardrails: ${files.guardrails.guardrails.length}`);
  }

  if (files.sessions) {
    log.step(`Sessions: ${files.sessions.sessions.length}`);
  }
}

export async function handleSetup(
  dir: string,
  options: SetupOptions,
): Promise<void> {
  const absDir = path.resolve(dir);
  if (!existsSync(absDir)) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  intro(`mg setup — ${absDir}`);

  // 1. Load and validate all files
  log.step("Loading YAML files...");
  const files = loadSetupFiles(absDir);
  log.success("All YAML files validated");

  // 2. Dry-run: print plan and exit
  if (options.dryRun) {
    printDryRun(files);
    outro("Dry-run complete — no changes made");
    return;
  }

  const registry = new IdRegistry();

  // 3. Create org
  log.step("Creating organization...");
  const org = await handleCreateOrg(files.org, registry);
  log.success(`Org: ${org.name} (${org.slug})`);

  const orgId = org.id;

  // 4. Create users
  if (files.users) {
    log.step("Creating users...");
    const userResult = await handleAddUsers(orgId, files.users.users, registry);
    log.success(
      `Users: ${userResult.created} created, ${userResult.existing} existing`,
    );
  }

  // 5. Create connectors (includes secrets)
  if (files.connectors) {
    log.step("Creating connectors...");
    const connResult = await handleAddConnectors(
      orgId,
      files.connectors.connectors,
      {
        skipSecrets: options.skipSecrets,
        registry,
      },
    );
    log.success(
      `Connectors: ${connResult.created} created, ${connResult.existing} existing`,
    );
  }

  // 6. Create agents
  let agentResult: Awaited<ReturnType<typeof handleAddAgents>> | undefined;
  if (files.agents) {
    log.step("Creating agents...");
    agentResult = await handleAddAgents(orgId, files.agents.agents, {
      registry,
    });
    log.success(
      `Agents: ${agentResult.created} created, ${agentResult.existing} existing`,
    );
  }

  // 7. Import SOPs
  if (files.sops) {
    log.step("Importing SOPs...");
    const sopResult = await handleImportSops(orgId, files.sops.sops, {
      registry,
    });
    log.success(
      `SOPs: ${sopResult.created} imported (${sopResult.activated} active)`,
    );
  }

  // 8. Import guardrails
  if (files.guardrails) {
    log.step("Importing guardrails...");
    const guardrailResult = await handleImportGuardrails(
      orgId,
      files.guardrails.guardrails,
      { registry },
    );
    log.success(
      `Guardrails: ${guardrailResult.created} created, ${guardrailResult.existing} existing`,
    );
  }

  // 9. Compile agents
  if (!options.skipCompile) {
    log.step("Compiling agents...");
    const compileResult = await handleCompileAgents(orgId, { registry });
    log.success(
      `Compiled: ${compileResult.compiled} agents, ${compileResult.skipped} skipped`,
    );
  }

  // 10. Import sessions
  if (files.sessions && !options.skipSessions) {
    log.step("Importing sessions...");
    const sessionResult = await handleImportSessions(
      orgId,
      files.sessions.sessions,
      { registry },
    );
    log.success(`Sessions: ${sessionResult.created} imported`);
  }

  // Summary
  log.step("Summary:");
  log.info(`Org: ${org.name} (${org.slug})`);

  if (files.users) {
    const tbl = table(
      ["Name", "Email", "Role"],
      files.users.users.map((u) => [u.name, u.email, u.role]),
    );
    log.info(`Users:\n${tbl}`);
  }

  if (agentResult && agentResult.apiKeys.length > 0) {
    const tbl = table(
      ["Agent", "API Key"],
      agentResult.apiKeys.map((k) => [k.name, k.key]),
    );
    log.info(`API Keys (shown once):\n${tbl}`);
  }

  outro("Setup complete");
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Full org provisioning from a YAML directory")
    .argument("<dir>", "Directory with YAML config files")
    .option("--dry-run", "Validate and print plan without making changes")
    .option("--skip-secrets", "Use placeholder values for secrets")
    .option("--skip-compile", "Skip agent compilation")
    .option("--skip-sessions", "Skip session import")
    .action(async (dir: string, opts) => {
      try {
        await handleSetup(dir, {
          dryRun: opts.dryRun,
          skipSecrets: opts.skipSecrets,
          skipCompile: opts.skipCompile,
          skipSessions: opts.skipSessions,
        });
      } catch (err) {
        log.error(`Setup failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
