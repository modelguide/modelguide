#!/usr/bin/env bun
/**
 * ModelGuide CLI — Customer onboarding tool.
 *
 * Thin orchestration layer over the existing service layer.
 * All business logic delegated to services; CLI handles parsing, validation, and output.
 */

// Load env validation before anything else
import "@/env";

import { closeDatabase } from "@db/client";
import { Command } from "commander";
import { registerAddAgentsCommand } from "./commands/add-agents";
import { registerAddConnectorsCommand } from "./commands/add-connectors";
import { registerAddSecretsCommand } from "./commands/add-secrets";
import { registerAddUsersCommand } from "./commands/add-users";
import { registerCompileAgentsCommand } from "./commands/compile-agents";
import { registerCreateOrgCommand } from "./commands/create-org";
import { registerImportEvalsCommand } from "./commands/import-evals";
import { registerImportGuardrailsCommand } from "./commands/import-guardrails";
import { registerImportPersonasCommand } from "./commands/import-personas";
import { registerImportSessionsCommand } from "./commands/import-sessions";
import { registerImportSopsCommand } from "./commands/import-sops";
import { registerRunEvalsCommand } from "./commands/run-evals";
import { registerSetupCommand } from "./commands/setup";
import { registerSyncAgentCommand } from "./commands/sync-agent";
import { getErrorMessage } from "./lib/errors";
import { log } from "./lib/logger";

const program = new Command()
  .name("mg")
  .description("ModelGuide CLI — customer onboarding and org provisioning")
  .version("0.1.0");

registerCreateOrgCommand(program);
registerAddUsersCommand(program);
registerAddSecretsCommand(program);
registerAddConnectorsCommand(program);
registerAddAgentsCommand(program);
registerImportSopsCommand(program);
registerImportGuardrailsCommand(program);
registerImportPersonasCommand(program);
registerImportEvalsCommand(program);
registerImportSessionsCommand(program);
registerCompileAgentsCommand(program);
registerSyncAgentCommand(program);
registerRunEvalsCommand(program);
registerSetupCommand(program);

if (import.meta.main) {
  program
    .parseAsync(process.argv)
    .then(() => closeDatabase())
    .catch(async (err) => {
      log.error(getErrorMessage(err));
      await closeDatabase();
      process.exit(1);
    });
}

export { program };
