/**
 * ElevenLabs sync service
 *
 * Creates/updates all ElevenLabs entities (secret, MCP server, webhook)
 * and assigns them to the ElevenLabs agent.
 */

import { env } from "@/env";
import { forOrg } from "@db/rls";
import { agents } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  getAgentElevenLabsKey,
  getAgentModelGuideKey,
} from "@features/secrets";
import { Errors } from "@lib/errors";
import { eq } from "drizzle-orm";

/**
 * Thin wrapper around ElevenLabs secrets API.
 * The SDK has a response parsing bug (requires `name` which the API may omit),
 * so we call the REST endpoint directly for secrets only.
 */
const EL_SECRETS_BASE = "https://api.elevenlabs.io/v1/convai/secrets";

async function elSecretsRequest(
  apiKey: string,
  method: "POST" | "PATCH",
  secretId: string | undefined,
  body: Record<string, string>,
): Promise<{ secret_id?: string; secretId?: string }> {
  const url = secretId ? `${EL_SECRETS_BASE}/${secretId}` : EL_SECRETS_BASE;
  const res = await fetch(url, {
    method,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(
      method === "PATCH" ? { type: "update", ...body } : body,
    ),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs secrets API ${method} ${res.status}: ${text}`);
  }
  return res.json();
}

interface SyncStep {
  step: string;
  status: "success" | "skipped" | "error";
  message?: string;
}

export interface SyncResult {
  secretId: string | null;
  mcpServerId: string;
  webhookId: string;
  syncedAt: string;
  steps: SyncStep[];
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
  const elMeta = (meta.elevenlabs ?? {}) as Record<string, unknown>;
  const elevenLabsAgentId = elMeta.agentId as string | undefined;
  const slug = agent.slug;

  if (!elevenLabsAgentId) {
    throw Errors.invalidInput(
      "ElevenLabs Agent ID must be set in metadata.elevenlabs.agentId",
    );
  }

  // 2. Get per-agent ElevenLabs API key
  const apiKey = await getAgentElevenLabsKey(orgId, agentId);
  if (!apiKey) {
    throw Errors.invalidInput(
      "ElevenLabs API key not configured for this agent",
    );
  }

  // 3. Get ModelGuide API key for MCP auth (optional — agents created before secret storage won't have it)
  const mgApiKey = await getAgentModelGuideKey(orgId, agentId);

  const client = new ElevenLabsClient({ apiKey });
  if (!env.API_EXTERNAL_ADDRESS) {
    throw new Error("API_EXTERNAL_ADDRESS is required for ElevenLabs sync");
  }
  const baseUrl = env.API_EXTERNAL_ADDRESS.replace(/\/$/, "");
  const steps: SyncStep[] = [];

  // Step 1: Create/update ElevenLabs secret (ModelGuide API key)
  let secretId = elMeta.secretId as string | undefined;
  if (!mgApiKey) {
    steps.push({
      step: "API key secret",
      status: "skipped",
      message: "No ModelGuide API key — regenerate to enable",
    });
  } else {
    try {
      if (secretId) {
        await elSecretsRequest(apiKey, "PATCH", secretId, {
          name: `${slug}_apikey`,
          value: mgApiKey,
        });
        steps.push({
          step: "API key secret",
          status: "success",
          message: "Updated existing secret",
        });
      } else {
        const res = await elSecretsRequest(apiKey, "POST", undefined, {
          name: `${slug}_apikey`,
          value: mgApiKey,
        });
        secretId = res.secret_id ?? res.secretId;
        steps.push({
          step: "API key secret",
          status: "success",
          message: "Created secret",
        });
      }
    } catch (err) {
      steps.push({
        step: "API key secret",
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
      throw err;
    }
  }

  // Step 2: Create/update MCP server (STREAMABLE_HTTP)
  let mcpServerId = elMeta.mcpServerId as string | undefined;
  const mcpConfig = {
    url: `${baseUrl}/mcp/${agentId}`,
    name: `${slug}_mcp`,
    description: "ModelGuide connector tools",
    transport: "STREAMABLE_HTTP" as const,
    approvalPolicy: "auto_approve_all" as const,
    ...(secretId ? { secretToken: { secretId } } : {}),
  };

  // Fetch current ElevenLabs agent state (used for MCP list + agent name)
  const elAgent = await client.conversationalAi.agents.get(elevenLabsAgentId);

  // ElevenLabs API silently ignores URL changes on MCP server update, so we
  // must delete + recreate.  Order: unassign from agent → delete old → create new.
  // The new server gets reassigned to the agent in the agent configuration step.
  const currentMcpIds: string[] =
    // biome-ignore lint/suspicious/noExplicitAny: ElevenLabs SDK types don't expose mcpServerIds
    (elAgent as any).conversationConfig?.agent?.prompt?.mcpServerIds ?? [];
  const oldMcpServerId = mcpServerId;

  try {
    if (oldMcpServerId) {
      // Unassign our MCP server from agent so we can delete it
      const otherMcpIds = currentMcpIds.filter(
        (id: string) => id !== oldMcpServerId,
      );
      await client.conversationalAi.agents.update(elevenLabsAgentId, {
        conversationConfig: {
          agent: { prompt: { mcpServerIds: otherMcpIds } },
          // biome-ignore lint/suspicious/noExplicitAny: ElevenLabs SDK types don't expose mcpServerIds
        } as any,
      });
      await client.conversationalAi.mcpServers.delete(oldMcpServerId);
    }
    const mcpServer = await client.conversationalAi.mcpServers.create({
      config: mcpConfig,
    });
    mcpServerId = mcpServer.id;
    steps.push({
      step: "MCP server",
      status: "success",
      message: oldMcpServerId ? "Recreated" : "Created",
    });
  } catch (err) {
    steps.push({
      step: "MCP server",
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    throw err;
  }

  // Step 3: Delete + recreate webhook to ensure URL is current
  let webhookId = elMeta.webhookId as string | undefined;
  let webhookSecret = meta.webhook_hmac_secret as string | undefined;

  try {
    if (webhookId) {
      try {
        await client.webhooks.delete(webhookId);
      } catch {
        // Best-effort: webhook may already be deleted on ElevenLabs side
      }
    }
    const webhook = await client.webhooks.create({
      settings: {
        authType: "hmac",
        name: `${slug}_postcall`,
        webhookUrl: `${baseUrl}/webhooks/elevenlabs/${agentId}/post-call`,
      },
    });
    const prevWebhookId = webhookId;
    webhookId = webhook.webhookId;
    webhookSecret = webhook.webhookSecret ?? undefined;
    steps.push({
      step: "Post-call webhook",
      status: "success",
      message: prevWebhookId ? "Recreated" : "Created",
    });
  } catch (err) {
    steps.push({
      step: "Post-call webhook",
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    throw err;
  }

  // Step 4: Assign new MCP server + webhook to ElevenLabs agent
  try {
    // Preserve other MCP servers, add our new one
    const otherMcpIds = currentMcpIds.filter(
      (id: string) => id !== oldMcpServerId,
    );
    const mergedMcpIds = [...otherMcpIds, mcpServerId!];

    await client.conversationalAi.agents.update(elevenLabsAgentId, {
      conversationConfig: {
        agent: {
          prompt: {
            mcpServerIds: mergedMcpIds,
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: ElevenLabs SDK types don't expose mcpServerIds
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
    steps.push({ step: "Agent configuration", status: "success" });
  } catch (err) {
    steps.push({
      step: "Agent configuration",
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    throw err;
  }

  // Step 5: Save metadata (agent name from earlier fetch)
  const elAgentName = elAgent.name;
  const syncedAt = new Date().toISOString();
  const updatedMetadata: Record<string, unknown> = {
    ...meta,
    elevenlabs: {
      ...elMeta,
      secretId,
      mcpServerId,
      webhookId,
      ...(elAgentName ? { agentName: elAgentName } : {}),
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

  steps.push({ step: "Save sync results", status: "success" });

  return {
    secretId: secretId ?? null,
    mcpServerId: mcpServerId!,
    webhookId: webhookId!,
    syncedAt,
    steps,
  };
}
