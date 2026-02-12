/**
 * ElevenLabs sync service
 *
 * Creates/updates all ElevenLabs entities (secret, MCP server, webhook)
 * and assigns them to the ElevenLabs agent.
 */

import { env } from "@/env";
import { forOrg } from "@db/rls";
import { agents, secrets } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  getAgentElevenLabsKey,
  getAgentModelGuideKey,
} from "@features/secrets";
import { encryptSecret } from "@lib/crypto";
import { Errors } from "@lib/errors";
import { and, eq } from "drizzle-orm";

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
      { type: method === "PATCH" ? "update" : "new", ...body },
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
  const mcpName = `${slug}_mcp`;
  const mcpConfig = {
    url: `${baseUrl}/mcp/${agentId}`,
    name: mcpName,
    description: "ModelGuide connector tools",
    transport: "STREAMABLE_HTTP" as const,
    approvalPolicy: "auto_approve_all" as const,
    ...(secretId ? { secretToken: { secretId } } : {}),
  };

  // Fetch current ElevenLabs agent state (used for MCP list + agent name)
  const elAgent = await client.conversationalAi.agents.get(elevenLabsAgentId);

  // ElevenLabs API silently ignores URL changes on MCP server update, so we
  // must delete + recreate.  We also clean up any orphaned MCP servers from
  // failed prior syncs by checking all assigned servers, not just the one in metadata.
  const currentMcpIds: string[] =
    // biome-ignore lint/suspicious/noExplicitAny: ElevenLabs SDK types don't expose mcpServerIds
    (elAgent as any).conversationConfig?.agent?.prompt?.mcpServerIds ?? [];

  // Identify all our MCP servers (metadata + any orphans matching our name)
  const ourMcpIds = new Set<string>();
  if (mcpServerId) ourMcpIds.add(mcpServerId);
  for (const id of currentMcpIds) {
    try {
      const server = await client.conversationalAi.mcpServers.get(id);
      if (server.config?.name === mcpName) {
        ourMcpIds.add(id);
      }
    } catch {
      // Server may not exist anymore — skip
    }
  }

  // Foreign MCP servers to preserve
  const foreignMcpIds = currentMcpIds.filter((id) => !ourMcpIds.has(id));

  try {
    // Unassign all our MCP servers from agent
    if (ourMcpIds.size > 0) {
      try {
        await client.conversationalAi.agents.update(elevenLabsAgentId, {
          conversationConfig: {
            agent: { prompt: { mcpServerIds: foreignMcpIds } },
            // biome-ignore lint/suspicious/noExplicitAny: ElevenLabs SDK types don't expose mcpServerIds
          } as any,
        });
      } catch {
        // Best-effort
      }

      // Delete all our old MCP servers
      for (const id of ourMcpIds) {
        try {
          await client.conversationalAi.mcpServers.delete(id);
        } catch {
          // Best-effort: may already be deleted
        }
      }
    }

    const mcpServer = await client.conversationalAi.mcpServers.create({
      config: mcpConfig,
    });
    mcpServerId = mcpServer.id;
    steps.push({
      step: "MCP server",
      status: "success",
      message:
        ourMcpIds.size > 0
          ? `Recreated (cleaned up ${ourMcpIds.size} old server${ourMcpIds.size > 1 ? "s" : ""})`
          : "Created",
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
  let webhookSecret: string | undefined;

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
    const mergedMcpIds = [...foreignMcpIds, mcpServerId!];

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

  // Step 5: Save webhook secret to encrypted secrets table + save metadata
  const elAgentName = elAgent.name;
  const syncedAt = new Date().toISOString();

  // Remove webhook_hmac_secret from metadata if it existed before migration
  const { webhook_hmac_secret: _removed, ...cleanMeta } = meta;
  const updatedMetadata: Record<string, unknown> = {
    ...cleanMeta,
    elevenlabs: {
      ...elMeta,
      secretId,
      mcpServerId,
      webhookId,
      ...(elAgentName ? { agentName: elAgentName } : {}),
      lastSyncedAt: syncedAt,
    },
  };

  await forOrg(orgId, async (tx) => {
    // Upsert webhook secret in secrets table
    if (webhookSecret) {
      const encryptedValue = await encryptSecret(webhookSecret);
      const [existing] = await tx
        .select({ id: secrets.id })
        .from(secrets)
        .where(
          and(
            eq(secrets.ownerType, "agent"),
            eq(secrets.ownerId, agentId),
            eq(secrets.secretType, "webhook_secret"),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(secrets)
          .set({ encryptedValue })
          .where(eq(secrets.id, existing.id));
      } else {
        await tx.insert(secrets).values({
          organizationId: orgId,
          name: "Webhook HMAC Secret",
          secretType: "webhook_secret",
          encryptedValue,
          ownerType: "agent",
          ownerId: agentId,
        });
      }
    }

    await tx
      .update(agents)
      .set({ metadata: updatedMetadata })
      .where(eq(agents.id, agentId));
  });

  steps.push({ step: "Save sync results", status: "success" });

  return {
    secretId: secretId ?? null,
    mcpServerId: mcpServerId!,
    webhookId: webhookId!,
    syncedAt,
    steps,
  };
}
