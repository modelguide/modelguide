/**
 * mg import-sessions — Import demo sessions from YAML.
 * Creates sessions, adds messages, updates status, and adds feedback.
 */

import { listAgents } from "@features/agents/agents.service";
import { addFeedback } from "@features/feedback/feedback.service";
import {
  addMessages,
  createSession,
  updateSession,
} from "@features/sessions/sessions.service";
import type { Command } from "commander";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type SessionItemInput,
  sessionsFileSchema,
} from "../schemas/sessions.schema";

export async function handleImportSessions(
  orgId: string,
  items: SessionItemInput[],
  options?: { registry?: IdRegistry },
): Promise<{ created: number }> {
  // Build agent slug→id map from registry or DB
  const agentMap = new Map<string, string>();
  if (options?.registry) {
    for (const [slug, id] of options.registry.getAll("agent")) {
      agentMap.set(slug, id);
    }
  }
  // Supplement with DB lookup for slugs not in registry
  const missingSlugs = [...new Set(items.map((i) => i.agentSlug))].filter(
    (s) => !agentMap.has(s),
  );
  if (missingSlugs.length > 0) {
    const { data: agents } = await listAgents(orgId, {
      page: 1,
      pageSize: 100,
    });
    for (const agent of agents) {
      if (missingSlugs.includes(agent.slug)) {
        agentMap.set(agent.slug, agent.id);
      }
    }
  }

  let created = 0;

  for (const item of items) {
    const agentId = agentMap.get(item.agentSlug);
    if (!agentId) {
      log.warn(`Agent "${item.agentSlug}" not found, skipping session`);
      continue;
    }

    // Create session (always starts as active so we can add messages)
    const session = await createSession(orgId, agentId, {
      channelType: item.channel,
      userIdentifier: item.userIdentifier,
      mode: "simulation",
    });

    // Add messages
    const startTime = Date.now() - item.hoursAgo * 60 * 60 * 1000;
    const messages = item.messages.map((msg, idx) => ({
      role: msg.role,
      content: msg.content,
      occurredAt: new Date(startTime + idx * 15000),
    }));

    await addMessages(orgId, session.id, agentId, messages);

    // Update to final status
    if (item.status !== "active") {
      await updateSession(orgId, session.id, agentId, {
        status: item.status,
      });
    }

    // Add feedback
    if (item.feedback) {
      await addFeedback(orgId, session.id, {
        rating: item.feedback.rating,
        comment: item.feedback.comment,
        feedbackSource: item.feedback.source,
      });
    }

    if (options?.registry) {
      options.registry.set(
        "session",
        `${item.agentSlug}-${created}`,
        session.id,
      );
    }

    log.success(
      `Created session: ${item.agentSlug} (${item.channel}, ${item.messages.length} messages)`,
    );
    created++;
  }

  return { created };
}

export function registerImportSessionsCommand(program: Command): void {
  program
    .command("import-sessions")
    .description("Import demo sessions from YAML file")
    .requiredOption("--org <slug>", "Organization slug")
    .argument("<file>", "YAML file path")
    .action(async (file: string, opts) => {
      const orgId = await resolveOrgId(opts.org);
      const data = loadYaml(file, sessionsFileSchema);

      try {
        const result = await handleImportSessions(orgId, data.sessions);
        log.success(`Sessions: ${result.created} imported`);
      } catch (err) {
        log.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
