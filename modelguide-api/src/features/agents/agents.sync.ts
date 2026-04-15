/**
 * ElevenLabs sync service
 *
 * Creates/updates all ElevenLabs entities (secret, MCP server, webhook)
 * and assigns them to the ElevenLabs agent.
 */

import { env } from "@/env";
import { forOrg } from "@db/rls";
import { agents, secrets } from "@db/schema";
import type { EntitySecretsMap } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  getAgentElevenLabsKey,
  getAgentModelGuideKey,
} from "@features/secrets";
import { encryptSecret } from "@lib/crypto";
import { Errors, getErrorMessage, logAndThrow } from "@lib/errors";
import { getLogger } from "@lib/logger";
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
    body: JSON.stringify({
      type: method === "PATCH" ? "update" : "new",
      ...body,
    }),
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
  return _syncAgentToElevenLabs(orgId, agentId).catch((err) => {
    logAndThrow(getLogger(), err, { agentId }, "ElevenLabs sync failed");
  });
}

async function _syncAgentToElevenLabs(
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
  const elMetaRaw = meta.elevenlabs;
  if (
    elMetaRaw !== undefined &&
    (typeof elMetaRaw !== "object" ||
      elMetaRaw === null ||
      Array.isArray(elMetaRaw))
  ) {
    throw Errors.invalidInput(
      "Corrupt elevenlabs metadata — expected an object",
    );
  }
  const elMeta = (elMetaRaw ?? {}) as Record<string, unknown>;
  let elevenLabsAgentId = elMeta.agentId as string | undefined;
  const slug = agent.slug;

  // 2. Guard: LLM model must be configured before any ElevenLabs side effects
  const llmModel = elMeta.llmModel as string | undefined;
  if (!llmModel) {
    throw Errors.invalidInput(
      "LLM model must be configured before syncing to ElevenLabs",
    );
  }

  // 3. Get per-agent ElevenLabs API key
  const apiKey = await getAgentElevenLabsKey(orgId, agentId);
  if (!apiKey) {
    throw Errors.invalidInput(
      "ElevenLabs API key not configured for this agent",
    );
  }

  // 4. Get ModelGuide API key for MCP auth (optional — agents created before secret storage won't have it)
  const mgApiKey = await getAgentModelGuideKey(orgId, agentId);

  const client = new ElevenLabsClient({ apiKey });
  if (!env.API_EXTERNAL_ADDRESS) {
    throw new Error("API_EXTERNAL_ADDRESS is required for ElevenLabs sync");
  }
  const baseUrl = env.API_EXTERNAL_ADDRESS.replace(/\/$/, "");
  const steps: SyncStep[] = [];

  // 5. Auto-provision ElevenLabs agent shell if not yet created
  if (!elevenLabsAgentId) {
    try {
      const created = await client.conversationalAi.agents.create({
        name: agent.name,
        conversationConfig: {},
      });
      elevenLabsAgentId = created.agentId;
      await forOrg(orgId, (tx) =>
        tx
          .update(agents)
          .set({
            metadata: {
              ...meta,
              elevenlabs: { ...elMeta, agentId: elevenLabsAgentId },
            },
          })
          .where(eq(agents.id, agentId)),
      );
      steps.push({
        step: "Create ElevenLabs agent",
        status: "success",
        message: `Agent ID: ${elevenLabsAgentId}`,
      });
    } catch (err) {
      steps.push({
        step: "Create ElevenLabs agent",
        status: "error",
        message: getErrorMessage(err),
      });
      throw err;
    }
  }

  // 6. Create/update ElevenLabs secret (ModelGuide API key)
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
        message: getErrorMessage(err),
      });
      throw err;
    }
  }

  // 7. Create/update MCP server (STREAMABLE_HTTP)
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
  let elAgent: Awaited<ReturnType<typeof client.conversationalAi.agents.get>>;
  try {
    elAgent = await client.conversationalAi.agents.get(elevenLabsAgentId);
  } catch (err) {
    logAndThrow(
      getLogger(),
      err,
      { agentId, elevenLabsAgentId },
      "ElevenLabs agent fetch failed — check agent ID and API key",
    );
  }

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
      } catch (err) {
        getLogger().warn(
          { agentId, err: getErrorMessage(err) },
          "MCP server unassign failed (best-effort) — proceeding with cleanup",
        );
      }

      // Delete all our old MCP servers
      for (const id of ourMcpIds) {
        try {
          await client.conversationalAi.mcpServers.delete(id);
        } catch (err) {
          getLogger().warn(
            { agentId, mcpServerId: id, err: getErrorMessage(err) },
            "MCP server delete failed (best-effort) — server may already be deleted or orphaned",
          );
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
      message: getErrorMessage(err),
    });
    throw err;
  }

  // 8. Delete + recreate webhook to ensure URL is current
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
      message: getErrorMessage(err),
    });
    throw err;
  }

  // Determine compiled prompt (llmModel already validated above)
  const compiledPrompt = agent.compiledInstructions ?? undefined;

  // 9. Assign new MCP server + webhook + conversation-init + prompt + model to ElevenLabs agent
  try {
    const mergedMcpIds = [...foreignMcpIds, mcpServerId!];

    // Build conversation-init webhook config (only when secretId exists)
    const conversationInitConfig = secretId
      ? {
          conversationInitiationClientDataWebhook: {
            url: `${baseUrl}/webhooks/elevenlabs/${agentId}/conversation-init`,
            requestHeaders: {
              "x-mg-api-key": { secretId },
            },
          },
        }
      : {};

    // Build prompt payload — llmModel is guaranteed set (guarded above)
    const promptPayload: Record<string, unknown> = {
      mcpServerIds: mergedMcpIds,
      llm: llmModel,
    };
    if (compiledPrompt) {
      promptPayload.prompt = compiledPrompt;
      promptPayload.ignoreDefaultPersonality = true;
    }

    await client.conversationalAi.agents.update(elevenLabsAgentId, {
      conversationConfig: {
        agent: {
          prompt: promptPayload,
        },
        // biome-ignore lint/suspicious/noExplicitAny: ElevenLabs SDK types don't expose mcpServerIds/ignoreDefaultPersonality
      } as any,
      platformSettings: {
        overrides: {
          enableConversationInitiationClientDataFromWebhook: !!secretId,
        },
        workspaceOverrides: {
          ...conversationInitConfig,
          webhooks: {
            postCallWebhookId: webhookId,
            events: ["transcript"],
          },
        },
      },
    });
    steps.push({
      step: "Agent configuration",
      status: "success",
      message: compiledPrompt
        ? `Applied compiled prompt + LLM model (${llmModel})`
        : `Applied LLM model (${llmModel}) — no compiled prompt`,
    });
  } catch (err) {
    steps.push({
      step: "Agent configuration",
      status: "error",
      message: getErrorMessage(err),
    });
    throw err;
  }

  // Report conversation-init webhook status
  if (secretId) {
    steps.push({
      step: "Conversation-init webhook",
      status: "success",
      message: `URL: ${baseUrl}/webhooks/elevenlabs/${agentId}/conversation-init`,
    });
  } else {
    steps.push({
      step: "Conversation-init webhook",
      status: "skipped",
      message: "No API key secret — regenerate to enable",
    });
  }

  // 10. Save webhook secret to encrypted secrets table + save metadata
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
    // Upsert webhook secret in org vault and maintain ref in agents.secrets map
    if (webhookSecret) {
      const encryptedValue = await encryptSecret(webhookSecret);

      // Fetch current secrets map for this agent
      const [agentRow] = await tx
        .select({ secrets: agents.secrets })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      const secretsMap = (agentRow?.secrets ?? {}) as EntitySecretsMap;
      const existingSecretId = secretsMap.webhook_secret;

      if (existingSecretId) {
        // Update vault entry in-place; ref unchanged
        await tx
          .update(secrets)
          .set({ encryptedValue })
          .where(eq(secrets.id, existingSecretId));
      } else {
        // Create new vault entry and write ref into agents.secrets map
        const [newSecret] = await tx
          .insert(secrets)
          .values({
            organizationId: orgId,
            name: "Webhook HMAC Secret",
            secretType: "webhook_secret",
            encryptedValue,
            scope: "agent",
          })
          .returning({ id: secrets.id });

        await tx
          .update(agents)
          .set({
            secrets: { ...secretsMap, webhook_secret: newSecret.id },
          })
          .where(eq(agents.id, agentId));
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
