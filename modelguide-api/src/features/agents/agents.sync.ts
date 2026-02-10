/**
 * ElevenLabs sync service
 *
 * Pushes MCP server URL and post-call webhook URL to ElevenLabs,
 * then stores the resulting IDs and HMAC secret in agent metadata.
 */

import { env } from "@/env";
import { agents } from "@db/schema";
import { forOrg } from "@db/rls";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { getAgentElevenLabsKey } from "@features/secrets";
import { Errors } from "@lib/errors";
import { eq } from "drizzle-orm";

interface SyncResult {
  mcpServerId: string;
  webhookId: string;
  webhookSecret: string;
  syncedAt: string;
}

export async function syncAgentToElevenLabs(
  orgId: string,
  agentId: string,
): Promise<SyncResult> {
  // 1. Load agent
  const [agent] = await forOrg(orgId, (tx) =>
    tx.select().from(agents).where(eq(agents.id, agentId)),
  );

  if (!agent) throw Errors.agentNotFound(agentId);
  if (agent.agentPlatform !== "elevenlabs") {
    throw Errors.invalidInput("Agent platform must be elevenlabs to sync");
  }

  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  const elevenlabsMeta = (meta.elevenlabs ?? {}) as Record<string, unknown>;
  const elevenLabsAgentId = elevenlabsMeta.agentId as string | undefined;

  if (!elevenLabsAgentId) {
    throw Errors.invalidInput(
      "ElevenLabs Agent ID must be set in metadata.elevenlabs.agentId",
    );
  }

  // 2. Get per-agent API key
  const apiKey = await getAgentElevenLabsKey(orgId, agentId);
  if (!apiKey) {
    throw Errors.invalidInput(
      "ElevenLabs API key not configured for this agent",
    );
  }

  const client = new ElevenLabsClient({ apiKey });
  const baseUrl = env.APP_URL;

  // 3. Create or reuse workspace webhook
  const webhookUrl = `${baseUrl}/webhooks/elevenlabs/${agentId}/post-call`;
  let webhookId = elevenlabsMeta.webhookId as string | undefined;
  let webhookSecret = meta.webhook_hmac_secret as string | undefined;

  if (!webhookId) {
    const webhook = await client.webhooks.create({
      settings: {
        authType: "hmac",
        name: `ModelGuide Post-Call (${agent.name})`,
        webhookUrl,
      },
    });
    webhookId = webhook.webhookId;
    webhookSecret = webhook.webhookSecret ?? undefined;
  }

  // 4. Create or reuse MCP server
  const mcpUrl = `${baseUrl}/mcp/${agentId}`;
  let mcpServerId = elevenlabsMeta.mcpServerId as string | undefined;

  if (!mcpServerId) {
    const mcpServer = await client.conversationalAi.mcpServers.create({
      config: {
        url: mcpUrl,
        name: `ModelGuide MCP (${agent.name})`,
        description: "ModelGuide connector tools via MCP",
      },
    });
    mcpServerId = mcpServer.id;
  }

  // 5. Update agent on ElevenLabs: assign webhook + MCP server
  await client.conversationalAi.agents.update(elevenLabsAgentId, {
    conversationConfig: {
      agent: {
        prompt: {
          mcpServerIds: [mcpServerId],
        },
      },
    } as any,
    platformSettings: {
      workspaceOverrides: {
        webhooks: {
          postCallWebhookId: webhookId,
          events: ["transcript"],
        },
      },
    },
  });

  // 6. Store sync results in agent metadata
  const syncedAt = new Date().toISOString();
  const updatedMetadata: Record<string, unknown> = {
    ...meta,
    elevenlabs: {
      ...elevenlabsMeta,
      mcpServerId,
      webhookId,
      lastSyncedAt: syncedAt,
    },
    ...(webhookSecret ? { webhook_hmac_secret: webhookSecret } : {}),
  };

  await forOrg(orgId, (tx) =>
    tx
      .update(agents)
      .set({ metadata: updatedMetadata })
      .where(eq(agents.id, agentId)),
  );

  return {
    mcpServerId,
    webhookId,
    webhookSecret: webhookSecret ?? "",
    syncedAt,
  };
}
