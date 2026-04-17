/**
 * mg sync-agent — Sync a compiled agent to ElevenLabs.
 *
 * Creates the shell ElevenLabs agent if it doesn't exist yet,
 * then pushes the compiled prompt, MCP server, and webhook configuration.
 * Mirrors the "Sync to ElevenLabs" button in the UI.
 */

import { listAgents } from "@features/agents/agents.service";
import {
  type SyncResult,
  syncAgentToElevenLabs,
} from "@features/agents/agents.sync";
import type { Command } from "commander";
import { getErrorMessage } from "../lib/errors";
import { log } from "../lib/logger";
import { resolveOrgId } from "../lib/resolve-org";

const PAGE_LIMIT = 100;

export async function handleSyncAgent(
  orgId: string,
  options?: { agentSlug?: string },
): Promise<{ synced: number; failed: number }> {
  const { data: allAgents } = await listAgents(orgId, {
    page: 1,
    pageSize: PAGE_LIMIT,
  });

  if (allAgents.length === PAGE_LIMIT) {
    log.warn(
      `Fetched ${PAGE_LIMIT} agents (pageSize cap). Org may have more — agents beyond this page will not be synced.`,
    );
  }

  let agentsToSync: typeof allAgents;
  if (options?.agentSlug) {
    const agent = allAgents.find((a) => a.slug === options.agentSlug);
    if (!agent) {
      throw new Error(`Agent "${options.agentSlug}" not found in org`);
    }
    if (agent.agentPlatform !== "elevenlabs") {
      throw new Error(
        `Agent "${options.agentSlug}" uses platform "${agent.agentPlatform}" — sync-agent only supports ElevenLabs agents`,
      );
    }
    agentsToSync = [agent];
  } else {
    agentsToSync = allAgents.filter((a) => a.agentPlatform === "elevenlabs");
  }

  if (agentsToSync.length === 0) {
    log.warn("Nothing to sync — no ElevenLabs agents in org");
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const agent of agentsToSync) {
    try {
      const result: SyncResult = await syncAgentToElevenLabs(orgId, agent.id);
      log.success(`Synced: ${agent.name}`);
      for (const s of result.steps) {
        const icon =
          s.status === "success" ? "✓" : s.status === "skipped" ? "–" : "✗";
        const msg = s.message ? `: ${s.message}` : "";
        log.info(`  ${icon} ${s.step}${msg}`);
      }
      synced++;
    } catch (err) {
      log.error(`Failed to sync ${agent.name}: ${getErrorMessage(err)}`);
      failed++;
    }
  }

  return { synced, failed };
}

export function registerSyncAgentCommand(program: Command): void {
  program
    .command("sync-agent")
    .description(
      "Sync agent(s) to ElevenLabs — pushes compiled prompt, MCP server, and webhook",
    )
    .requiredOption("--org <slug>", "Organization slug")
    .option(
      "--agent <slug>",
      "Sync only this agent (default: all ElevenLabs agents)",
    )
    .action(async (opts: { org: string; agent?: string }) => {
      const orgId = await resolveOrgId(opts.org);

      try {
        const result = await handleSyncAgent(orgId, { agentSlug: opts.agent });
        log.success(`Sync: ${result.synced} synced, ${result.failed} failed`);
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
