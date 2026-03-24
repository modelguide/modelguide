/**
 * mg compile-agents — Compile agents from their assigned SOPs.
 * Delegates to compiler.service.compileAgent.
 */

import { listAgents } from "@features/agents/agents.service";
import { compileAgent } from "@features/compiler/compiler.service";
import { listSops } from "@features/sops/sops.service";
import type { Command } from "commander";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { resolveOrgId } from "../lib/resolve-org";

export async function handleCompileAgents(
  orgId: string,
  options?: { agentSlug?: string; registry?: IdRegistry },
): Promise<{ compiled: number; skipped: number }> {
  // Get agents
  const { data: allAgents } = await listAgents(orgId, {
    page: 1,
    pageSize: 100,
  });

  const agentsToCompile = options?.agentSlug
    ? allAgents.filter((a) => a.slug === options.agentSlug)
    : allAgents;

  if (agentsToCompile.length === 0) {
    log.warn("No agents found to compile");
    return { compiled: 0, skipped: 0 };
  }

  let compiled = 0;
  let skipped = 0;

  for (const agent of agentsToCompile) {
    // Find active SOPs assigned to this agent
    const { data: agentSops } = await listSops(orgId, {
      agentId: agent.id,
      status: "active",
      page: 1,
      pageSize: 10,
    });

    if (agentSops.length === 0) {
      log.info(`No active SOPs for agent ${agent.name}, skipping`);
      skipped++;
      continue;
    }

    // Compile against each active SOP assigned to this agent
    for (const sop of agentSops) {
      try {
        await compileAgent({
          orgId,
          agentId: agent.id,
          sopId: sop.id,
        });
        log.success(`Compiled agent: ${agent.name} (SOP: ${sop.name})`);
        compiled++;
      } catch (err) {
        log.warn(
          `Failed to compile ${agent.name} with SOP ${sop.name}: ${(err as Error).message}`,
        );
        skipped++;
      }
    }
  }

  return { compiled, skipped };
}

export function registerCompileAgentsCommand(program: Command): void {
  program
    .command("compile-agents")
    .description("Compile agents from their assigned SOPs")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--agent <slug>", "Compile only this agent")
    .action(async (opts) => {
      const orgId = await resolveOrgId(opts.org);

      try {
        const result = await handleCompileAgents(orgId, {
          agentSlug: opts.agent,
        });
        log.success(
          `Compilation: ${result.compiled} compiled, ${result.skipped} skipped`,
        );
      } catch (err) {
        log.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
