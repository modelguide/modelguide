/**
 * mg import-sessions — Import demo sessions from YAML.
 * Creates sessions, adds messages, updates status, and adds feedback.
 * Re-imports are deduped by externalId (explicit or derived from the payload).
 */

import { forOrg } from "@db/rls";
import { sessionLinks, sessions } from "@db/schema";
import { addFeedback } from "@features/feedback/feedback.service";
import {
  addMessages,
  createSession,
  updateSession,
} from "@features/sessions/sessions.service";
import type { Command } from "commander";
import { and, eq } from "drizzle-orm";
import { getErrorMessage } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { lookupAgentIds } from "../lib/resolve-agents";
import { resolveOrgId } from "../lib/resolve-org";
import { buildImportedSessionExternalId } from "../lib/session-external-id";
import { loadYaml } from "../lib/yaml-loader";
import {
  type SessionItemInput,
  sessionsFileSchema,
} from "../schemas/sessions.schema";

async function findImportedSessionId(
  orgId: string,
  agentId: string,
  externalId: string,
): Promise<string | null> {
  const [existing] = await forOrg(orgId, (tx) =>
    tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(eq(sessions.agentId, agentId), eq(sessions.externalId, externalId)),
      )
      .limit(1),
  );

  return existing?.id ?? null;
}

async function addSessionLinks(
  orgId: string,
  sessionId: string,
  item: SessionItemInput,
): Promise<void> {
  if (item.links.length === 0) {
    return;
  }

  await forOrg(orgId, (tx) =>
    tx
      .insert(sessionLinks)
      .values(item.links.map((link) => ({ sessionId, ...link })))
      .onConflictDoNothing({
        target: [sessionLinks.sessionId, sessionLinks.url],
      }),
  );
}

export async function handleImportSessions(
  orgId: string,
  items: SessionItemInput[],
  options?: { registry?: IdRegistry },
): Promise<{ created: number }> {
  const agentMap = await lookupAgentIds(
    orgId,
    items.map((item) => item.agentSlug),
    options?.registry,
  );

  let created = 0;

  for (const item of items) {
    const agentId = agentMap.get(item.agentSlug);
    if (!agentId) {
      log.warn(`Agent "${item.agentSlug}" not found, skipping session`);
      continue;
    }

    const externalId = buildImportedSessionExternalId(item);
    const existingSessionId = await findImportedSessionId(
      orgId,
      agentId,
      externalId,
    );

    if (existingSessionId) {
      if (options?.registry) {
        options.registry.set("session", externalId, existingSessionId);
      }
      log.info(`Found existing session: ${item.agentSlug} (${externalId})`);
      continue;
    }

    // Create session (always starts as active so we can add messages)
    const session = await createSession(orgId, agentId, {
      externalId,
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
    await addSessionLinks(orgId, session.id, item);

    // Update to final status
    if (item.status !== "active") {
      await updateSession(orgId, session.id, agentId, {
        status: item.status,
      });
    }

    // Add feedback
    if (item.feedback) {
      await addFeedback(orgId, session.id, {
        rating: item.feedback.verdict === "good" ? 2 : 1,
        comment: item.feedback.comment,
        feedbackSource: item.feedback.source,
      });
    }

    if (options?.registry) {
      options.registry.set("session", externalId, session.id);
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
    .action(async (file: string, opts: { org: string }) => {
      const orgId = await resolveOrgId(opts.org);
      const data = loadYaml(file, sessionsFileSchema);

      try {
        const result = await handleImportSessions(orgId, data.sessions);
        log.success(`Sessions: ${result.created} imported`);
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
