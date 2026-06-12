/**
 * Agents service - business logic for agent management, API keys, and connector tool assignment
 */

import { forOrg } from "@db/rls";
import type { Transaction } from "@db/rls";
import {
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  connectorsCatalog,
  evalSuites,
  secrets,
} from "@db/schema";
import type { EntitySecretsMap, PromptConfig } from "@db/schema";
import { getAgentSecretByType } from "@features/secrets/secrets.service";
import {
  createSession,
  updateSession,
} from "@features/sessions/sessions.service";
import { generateApiKey } from "@lib/crypto";
import { encryptSecret } from "@lib/crypto";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { slugify } from "@lib/slugify";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  dispatchAgentToRoom,
  generateVoiceTestToken,
  pingLivekit,
} from "./livekit";

type Modality = (typeof agents.modality.enumValues)[number];
type ModelFamily = (typeof agents.modelFamily.enumValues)[number];
type AgentPlatform = (typeof agents.agentPlatform.enumValues)[number];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Verify agent exists within a forOrg transaction. Returns the agent row.
 * Use inside an existing `forOrg` call to avoid TOCTOU races.
 */
async function requireAgent(tx: Transaction, agentId: string) {
  const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));

  if (!agent) {
    throw Errors.agentNotFound(agentId);
  }

  return agent;
}

// ============================================================================
// Core Agent CRUD
// ============================================================================

export async function listAgents(
  orgId: string,
  pagination: PaginationParams,
  filters?: {
    isActive?: boolean;
    modality?: Modality;
    agentPlatform?: AgentPlatform;
  },
) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = [];
    if (filters?.isActive !== undefined) {
      conditions.push(eq(agents.isActive, filters.isActive));
    }
    if (filters?.modality) {
      conditions.push(eq(agents.modality, filters.modality));
    }
    if (filters?.agentPlatform) {
      conditions.push(eq(agents.agentPlatform, filters.agentPlatform));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(agents)
        .where(where)
        .orderBy(asc(agents.createdAt))
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(agents).where(where),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getAgentById(orgId: string, agentId: string) {
  return forOrg(orgId, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));

    if (!agent) {
      throw Errors.agentNotFound(agentId);
    }

    const [[activeKey], [{ evalSuiteCount }]] = await Promise.all([
      tx
        .select({ keyPrefix: apiKeys.keyPrefix })
        .from(apiKeys)
        .where(and(eq(apiKeys.agentId, agentId), eq(apiKeys.isActive, true))),
      tx
        .select({ evalSuiteCount: count() })
        .from(evalSuites)
        .where(eq(evalSuites.agentId, agentId)),
    ]);

    // Derive key presence from the entity secrets map
    const secretsMap = (agent.secrets ?? {}) as EntitySecretsMap;
    const hasElevenLabsKey = !!secretsMap.platform_api_key;
    const hasWebhookSecretRef = !!secretsMap.webhook_secret;

    const metadata = agent.metadata as Record<string, unknown> | null;
    const hasLegacyHmac = !!metadata?.webhook_hmac_secret;

    return {
      ...agent,
      keyPrefix: activeKey?.keyPrefix ?? null,
      hasElevenLabsKey,
      hasWebhookSecret: hasWebhookSecretRef || hasLegacyHmac,
      evalSuiteCount,
    };
  });
}

export async function createAgent(
  orgId: string,
  data: {
    name: string;
    slug?: string;
    description?: string;
    modality?: Modality;
    modelFamily?: ModelFamily;
    promptConfig?: PromptConfig;
    agentPlatform?: AgentPlatform;
    metadata?: Record<string, unknown>;
    secrets?: EntitySecretsMap;
  },
  createdBy: string,
) {
  return forOrg(orgId, async (tx) => {
    const slug = data.slug || slugify(data.name);

    // Check slug uniqueness within the org before insert
    const [existing] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.slug, slug));

    if (existing) {
      throw Errors.alreadyExists("Agent", "slug");
    }

    // Store raw API key as encrypted secret in vault; reference via agents.secrets map
    const keyData = generateApiKey();
    const encryptedKey = await encryptSecret(keyData.key);

    const [mgKeySecret] = await tx
      .insert(secrets)
      .values({
        organizationId: orgId,
        name: `${data.name} API Key`,
        secretType: "api_key",
        encryptedValue: encryptedKey,
        scope: "agent",
      })
      .returning({ id: secrets.id });

    // Merge caller-provided secrets with the auto-created MG key ref
    const secretsMap: EntitySecretsMap = {
      ...data.secrets,
      api_key: mgKeySecret.id,
    };

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: orgId,
        name: data.name,
        slug,
        description: data.description,
        modality: data.modality ?? "voice",
        modelFamily: data.modelFamily ?? "generic",
        promptConfig: data.promptConfig ?? {},
        agentPlatform: data.agentPlatform ?? "custom",
        metadata: data.metadata ?? {},
        secrets: secretsMap,
        isActive: false,
        createdBy,
      })
      .returning();

    await tx.insert(apiKeys).values({
      organizationId: orgId,
      agentId: agent.id,
      name: `${agent.name} API Key`,
      keyHash: keyData.hash,
      keyPrefix: keyData.prefix,
      isActive: true,
      createdBy,
    });

    return { agent, apiKey: keyData.key };
  });
}

export async function updateAgent(
  orgId: string,
  agentId: string,
  data: {
    name?: string;
    description?: string;
    modelFamily?: ModelFamily;
    promptConfig?: PromptConfig;
    metadata?: Record<string, unknown>;
    agentPlatform?: AgentPlatform;
    secrets?: EntitySecretsMap;
  },
) {
  const [updated] = await forOrg(orgId, async (tx) => {
    // Deep-merge metadata to prevent overwriting keys set by sync
    if (data.metadata) {
      const [current] = await tx
        .select({ metadata: agents.metadata })
        .from(agents)
        .where(eq(agents.id, agentId));
      const existing = (current?.metadata ?? {}) as Record<string, unknown>;
      data.metadata = { ...existing, ...data.metadata };
    }

    // Deep-merge secrets to preserve auto-managed keys (api_key, webhook_secret)
    if (data.secrets) {
      const [current] = await tx
        .select({ secrets: agents.secrets })
        .from(agents)
        .where(eq(agents.id, agentId));
      const existing = (current?.secrets ?? {}) as EntitySecretsMap;
      data.secrets = { ...existing, ...data.secrets };
    }

    return tx
      .update(agents)
      .set(data)
      .where(eq(agents.id, agentId))
      .returning();
  });

  if (!updated) {
    throw Errors.agentNotFound(agentId);
  }

  return updated;
}

export async function deleteAgent(
  orgId: string,
  agentId: string,
): Promise<void> {
  const [deleted] = await forOrg(orgId, (tx) =>
    tx
      .delete(agents)
      .where(eq(agents.id, agentId))
      .returning({ id: agents.id }),
  );

  if (!deleted) {
    throw Errors.agentNotFound(agentId);
  }
}

// ============================================================================
// Activation
// ============================================================================

export async function setAgentActive(
  orgId: string,
  agentId: string,
  isActive: boolean,
) {
  const [updated] = await forOrg(orgId, (tx) =>
    tx
      .update(agents)
      .set({ isActive })
      .where(eq(agents.id, agentId))
      .returning(),
  );

  if (!updated) {
    throw Errors.agentNotFound(agentId);
  }

  return updated;
}

// ============================================================================
// API Key Management
// ============================================================================

export async function regenerateApiKey(
  orgId: string,
  agentId: string,
  createdBy: string,
) {
  return forOrg(orgId, async (tx) => {
    const agent = await requireAgent(tx, agentId);

    await tx
      .update(apiKeys)
      .set({ isActive: false })
      .where(eq(apiKeys.agentId, agentId));

    const keyData = generateApiKey();
    const encryptedValue = await encryptSecret(keyData.key);

    await tx.insert(apiKeys).values({
      organizationId: orgId,
      agentId,
      name: `${agent.name} API Key`,
      keyHash: keyData.hash,
      keyPrefix: keyData.prefix,
      isActive: true,
      createdBy,
    });

    // Update the vault secret referenced by agents.secrets["api_key"]
    const secretsMap = (agent.secrets ?? {}) as EntitySecretsMap;
    const existingSecretId = secretsMap.api_key;

    if (existingSecretId) {
      // Update the existing vault entry in-place
      await tx
        .update(secrets)
        .set({ encryptedValue })
        .where(eq(secrets.id, existingSecretId));
    } else {
      // Create new vault entry and reference it
      const [newSecret] = await tx
        .insert(secrets)
        .values({
          organizationId: orgId,
          name: `${agent.name} API Key`,
          secretType: "api_key",
          encryptedValue,
          scope: "agent",
        })
        .returning({ id: secrets.id });

      await tx
        .update(agents)
        .set({
          secrets: { ...secretsMap, api_key: newSecret.id },
        })
        .where(eq(agents.id, agentId));
    }

    return { apiKey: keyData.key, keyPrefix: keyData.prefix };
  });
}

// ============================================================================
// Platform Key Management
// ============================================================================

export async function upsertAgentPlatformKey(
  orgId: string,
  agentId: string,
  value: string,
) {
  return forOrg(orgId, async (tx) => {
    const agent = await requireAgent(tx, agentId);

    const encryptedValue = await encryptSecret(value);
    const secretsMap = (agent.secrets ?? {}) as EntitySecretsMap;
    const existingSecretId = secretsMap.platform_api_key;

    if (existingSecretId) {
      // Update existing vault entry; keep agents.secrets ref unchanged
      await tx
        .update(secrets)
        .set({ encryptedValue })
        .where(eq(secrets.id, existingSecretId));
      return { action: "updated" as const };
    }

    // Create new vault entry and write ref into agents.secrets map
    const [newSecret] = await tx
      .insert(secrets)
      .values({
        organizationId: orgId,
        name: "ElevenLabs API Key",
        secretType: "platform_api_key",
        encryptedValue,
        scope: "agent",
      })
      .returning({ id: secrets.id });

    await tx
      .update(agents)
      .set({
        secrets: { ...secretsMap, platform_api_key: newSecret.id },
      })
      .where(eq(agents.id, agentId));

    return { action: "created" as const };
  });
}

// ============================================================================
// Agent Connector Tools (Junction Table)
//
// agent_connector_tools has NO RLS and NO organizationId column.
// Access control is enforced by verifying the agent belongs to the org
// (via the RLS-protected agents table) within the same forOrg transaction.
// Never query this table without joining through an RLS-scoped parent.
// ============================================================================

export async function listAgentConnectors(orgId: string, agentId: string) {
  return forOrg(orgId, async (tx) => {
    await requireAgent(tx, agentId);

    const rows = await tx
      .select({
        id: agentConnectorTools.id,
        connectorToolId: agentConnectorTools.connectorToolId,
        isEnabled: agentConnectorTools.isEnabled,
        requiresConfirmation: agentConnectorTools.requiresConfirmation,
        toolName: connectorTools.name,
        toolSlug: connectorTools.slug,
        connectorId: connectors.id,
        connectorSlug: connectors.slug,
        connectorName: connectors.name,
        connectorIconUrl: connectorsCatalog.iconUrl,
      })
      .from(agentConnectorTools)
      .innerJoin(
        connectorTools,
        and(
          eq(agentConnectorTools.connectorToolId, connectorTools.id),
          isNull(connectorTools.deletedAt),
        ),
      )
      .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
      .innerJoin(
        connectorsCatalog,
        eq(connectors.connectorCatalogId, connectorsCatalog.id),
      )
      .where(eq(agentConnectorTools.agentId, agentId))
      .orderBy(asc(connectors.name), asc(connectorTools.name));

    const grouped = new Map<
      string,
      {
        connectorId: string;
        connectorSlug: string;
        connectorName: string;
        connectorIconUrl: string | null;
        tools: {
          id: string;
          name: string;
          slug: string;
          isEnabled: boolean;
          requiresConfirmation: boolean;
        }[];
      }
    >();

    for (const row of rows) {
      if (!grouped.has(row.connectorId)) {
        grouped.set(row.connectorId, {
          connectorId: row.connectorId,
          connectorSlug: row.connectorSlug,
          connectorName: row.connectorName,
          connectorIconUrl: row.connectorIconUrl,
          tools: [],
        });
      }
      grouped.get(row.connectorId)!.tools.push({
        id: row.id,
        name: row.toolName,
        slug: row.toolSlug,
        isEnabled: row.isEnabled,
        requiresConfirmation: row.requiresConfirmation,
      });
    }

    return Array.from(grouped.values());
  });
}

export async function assignConnectorToAgent(
  orgId: string,
  agentId: string,
  data: {
    connectorId: string;
    tools: {
      slug: string;
      isEnabled?: boolean;
      requiresConfirmation?: boolean;
    }[];
  },
) {
  return forOrg(orgId, async (tx) => {
    await requireAgent(tx, agentId);

    const [connector] = await tx
      .select()
      .from(connectors)
      .where(eq(connectors.id, data.connectorId));

    if (!connector) {
      throw Errors.connectorNotFound(data.connectorId);
    }

    const toolSlugs = data.tools.map((t) => t.slug);
    const existingTools = await tx
      .select()
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, data.connectorId),
          inArray(connectorTools.slug, toolSlugs),
          isNull(connectorTools.deletedAt),
        ),
      );

    if (existingTools.length !== toolSlugs.length) {
      const foundSlugs = new Set(existingTools.map((t) => t.slug));
      const missing = toolSlugs.filter((s) => !foundSlugs.has(s));
      throw Errors.notFound("Connector tools", missing.join(", "));
    }

    const settingsBySlug = new Map(data.tools.map((t) => [t.slug, t]));

    const values = existingTools.map((tool) => {
      const settings = settingsBySlug.get(tool.slug)!;
      return {
        agentId,
        connectorToolId: tool.id,
        isEnabled: settings.isEnabled ?? true,
        requiresConfirmation: settings.requiresConfirmation ?? false,
      };
    });

    try {
      await tx.insert(agentConnectorTools).values(values);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("agent_connector_tools_unique")
      ) {
        throw Errors.alreadyExists("Agent connector tool assignment");
      }
      throw err;
    }

    return { assigned: values.length };
  });
}

export async function updateAgentConnectorTools(
  orgId: string,
  agentId: string,
  connectorId: string,
  data: {
    tools: {
      slug: string;
      isEnabled?: boolean;
      requiresConfirmation?: boolean;
    }[];
  },
) {
  return forOrg(orgId, async (tx) => {
    await requireAgent(tx, agentId);

    const cTools = await tx
      .select()
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, connectorId),
          isNull(connectorTools.deletedAt),
        ),
      );

    const slugToId = new Map(cTools.map((t) => [t.slug, t.id]));
    let updatedCount = 0;

    for (const tool of data.tools) {
      const connectorToolId = slugToId.get(tool.slug);
      if (!connectorToolId) {
        throw Errors.toolNotFound(tool.slug);
      }

      const setValues: { isEnabled?: boolean; requiresConfirmation?: boolean } =
        {};
      if (tool.isEnabled !== undefined) setValues.isEnabled = tool.isEnabled;
      if (tool.requiresConfirmation !== undefined)
        setValues.requiresConfirmation = tool.requiresConfirmation;

      if (Object.keys(setValues).length > 0) {
        const [result] = await tx
          .update(agentConnectorTools)
          .set(setValues)
          .where(
            and(
              eq(agentConnectorTools.agentId, agentId),
              eq(agentConnectorTools.connectorToolId, connectorToolId),
            ),
          )
          .returning({ id: agentConnectorTools.id });

        if (!result) {
          throw Errors.notFound("Agent connector tool assignment", tool.slug);
        }
        updatedCount++;
      }
    }

    return { updated: updatedCount };
  });
}

export async function removeConnectorFromAgent(
  orgId: string,
  agentId: string,
  connectorId: string,
): Promise<void> {
  await forOrg(orgId, async (tx) => {
    await requireAgent(tx, agentId);

    const cTools = await tx
      .select({ id: connectorTools.id })
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, connectorId),
          isNull(connectorTools.deletedAt),
        ),
      );

    if (cTools.length === 0) {
      throw Errors.connectorNotFound(connectorId);
    }

    const deleted = await tx
      .delete(agentConnectorTools)
      .where(
        and(
          eq(agentConnectorTools.agentId, agentId),
          inArray(
            agentConnectorTools.connectorToolId,
            cTools.map((t) => t.id),
          ),
        ),
      )
      .returning({ id: agentConnectorTools.id });

    if (deleted.length === 0) {
      throw Errors.notFound("Agent connector assignment");
    }
  });
}

// ============================================================================
// LiveKit Config
// ============================================================================

export async function upsertLivekitConfig(
  orgId: string,
  agentId: string,
  data: {
    url: string;
    apiKeySecretId: string;
    apiSecretSecretId: string;
    agentName: string;
  },
) {
  return forOrg(orgId, async (tx) => {
    const agent = await requireAgent(tx, agentId);
    const secretsMap = (agent.secrets ?? {}) as EntitySecretsMap;
    const isUpdate = !!secretsMap.livekit_api_key;

    // Store secret references in agent secrets map
    secretsMap.livekit_api_key = data.apiKeySecretId;
    secretsMap.livekit_api_secret = data.apiSecretSecretId;

    // Store non-secret config in metadata
    const metadata = (agent.metadata ?? {}) as Record<string, unknown>;
    metadata.livekit = {
      url: data.url,
      agentName: data.agentName,
    };

    await tx
      .update(agents)
      .set({ secrets: secretsMap, metadata })
      .where(eq(agents.id, agentId));

    return { action: isUpdate ? ("updated" as const) : ("created" as const) };
  });
}

export async function pingLivekitConfig(orgId: string, agentId: string) {
  const agent = await forOrg(orgId, (tx) => requireAgent(tx, agentId));

  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  const lkMeta = (meta.livekit ?? {}) as Record<string, unknown>;
  const livekitUrl = lkMeta.url as string | undefined;

  if (!livekitUrl) {
    throw Errors.invalidInput("LiveKit URL not configured");
  }

  const apiKey = await getAgentSecretByType(orgId, agentId, "livekit_api_key");
  const apiSecret = await getAgentSecretByType(
    orgId,
    agentId,
    "livekit_api_secret",
  );

  if (!apiKey || !apiSecret) {
    throw Errors.invalidInput("LiveKit credentials not configured");
  }

  await pingLivekit(livekitUrl, apiKey, apiSecret);
  return { ok: true };
}

// ============================================================================
// Outbound Calls
// ============================================================================

export async function createOutboundCall(
  orgId: string,
  agentId: string,
  data: { phoneNumber: string; email?: string; name?: string },
) {
  const agent = await forOrg(orgId, async (tx) => {
    const a = await requireAgent(tx, agentId);
    if (!a.isActive) throw Errors.invalidInput("Agent is not active");
    if (a.modality !== "voice")
      throw Errors.invalidInput("Outbound calls require a voice agent");
    if (a.agentPlatform !== "livekit")
      throw Errors.invalidInput(
        "Outbound calls are only supported for LiveKit agents",
      );
    return a;
  });

  // Read LiveKit config from agent metadata
  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  const lkMeta = (meta.livekit ?? {}) as Record<string, unknown>;
  const livekitUrl = lkMeta.url as string | undefined;
  const agentName = lkMeta.agentName as string | undefined;

  if (!livekitUrl || !agentName) {
    throw Errors.invalidInput(
      "LiveKit is not configured for this agent. Configure it first.",
    );
  }

  // Decrypt LiveKit credentials from vault
  const apiKey = await getAgentSecretByType(orgId, agentId, "livekit_api_key");
  const apiSecret = await getAgentSecretByType(
    orgId,
    agentId,
    "livekit_api_secret",
  );

  if (!apiKey || !apiSecret) {
    throw Errors.invalidInput(
      "LiveKit credentials not found. Re-configure LiveKit for this agent.",
    );
  }

  const roomName = `outbound-${nanoid()}`;

  // Create session first
  const session = await createSession(orgId, agentId, {
    channelType: "voice",
    userIdentifier: data.phoneNumber,
    userMetadata: {
      phone: data.phoneNumber,
      ...(data.email && { email: data.email }),
      ...(data.name && { name: data.name }),
    },
  });

  // Dispatch agent — clean up session on failure
  let dispatchId: string;
  try {
    dispatchId = await dispatchAgentToRoom(
      livekitUrl,
      apiKey,
      apiSecret,
      agentName,
      roomName,
      buildOutboundDispatchMetadata({
        agentSlug: agent.slug,
        sessionId: session.id,
        phoneNumber: data.phoneNumber,
        email: data.email,
        name: data.name,
      }),
    );
  } catch (err) {
    await updateSession(orgId, session.id, agentId, { status: "abandoned" });
    throw err;
  }

  return { sessionId: session.id, roomName, dispatchId };
}

/**
 * Build the dispatch-metadata payload for an outbound call.
 *
 * Mirrors ``buildVoiceTestDispatchMetadata`` — ``agentName`` is the
 * MG agent slug, which a multi-profile worker reads to pick the matching
 * profile (``dispatch_metadata.get("agentName")`` in the worker). Without
 * this field, a worker that hosts more than one profile can't route and
 * the dispatched call goes silent.
 *
 * ``user_identifier`` intentionally duplicates ``phone_number`` — downstream
 * session-attribution joins (transcripts, analytics) use ``user_identifier``
 * as the stable handle for the caller regardless of the call's modality.
 * Keeping both fields means callers reading the metadata don't have to know
 * which one to prefer.
 *
 * Extracted as a pure function so the contract is unit-tested rather than
 * living only inside ``createOutboundCall``.
 */
export function buildOutboundDispatchMetadata(input: {
  agentSlug: string;
  sessionId: string;
  phoneNumber: string;
  email?: string;
  name?: string;
}): {
  mode: "outbound";
  agentName: string;
  session_id: string;
  user_identifier: string;
  phone_number: string;
  email?: string;
  name?: string;
} {
  return {
    mode: "outbound" as const,
    agentName: input.agentSlug,
    session_id: input.sessionId,
    user_identifier: input.phoneNumber,
    phone_number: input.phoneNumber,
    ...(input.email !== undefined && { email: input.email }),
    ...(input.name !== undefined && { name: input.name }),
  };
}

// ============================================================================
// Voice-test (browser WebRTC "Talk to agent")
//
// Issues a short-lived LiveKit AccessToken scoped to a new room, creates a
// ModelGuide session, and dispatches the configured LiveKit worker into the
// room. The worker reads `agentName` from dispatch metadata and routes to
// the matching profile (prompt + tools baked into the worker image — we do
// NOT inject a prompt from here). This is the "talk to the live agent on
// this worker" flow, not a prompt-override smoke test.
// ============================================================================

/**
 * Build the dispatch-metadata payload for a voice-test session.
 *
 * Pure function so the MG-agent-slug ↔ worker-profile-slug coupling is
 * covered by a unit test. If the field names or shape ever drift, the
 * worker's entrypoint (demos/bank-nowa/voice-agent/src/agent.py —
 * `agentName = dispatch_metadata.get("agentName")`) stops routing to
 * the right profile and every dispatched call goes silent.
 */
export function buildVoiceTestDispatchMetadata(input: {
  agentSlug: string;
  sessionId: string;
  callerEmail: string;
}): {
  mode: "voice-test";
  agentName: string;
  session_id: string;
  user_identifier: string;
  email: string;
} {
  return {
    mode: "voice-test" as const,
    agentName: input.agentSlug,
    session_id: input.sessionId,
    user_identifier: input.callerEmail,
    email: input.callerEmail,
  };
}

export interface VoiceTestSession {
  livekitUrl: string;
  roomName: string;
  token: string;
  sessionId: string;
  dispatchId: string;
  agentName: string; // LiveKit worker name (which worker to dispatch into)
  profileName: string; // worker-internal profile slug (which agent inside)
  identity: string;
}

export async function createVoiceTestSession(
  orgId: string,
  agentId: string,
  caller: { userId: string; email: string; name: string },
): Promise<VoiceTestSession> {
  const agent = await forOrg(orgId, async (tx) => {
    const a = await requireAgent(tx, agentId);
    if (!a.isActive) {
      throw Errors.invalidInput("Agent is not active");
    }
    if (a.modality !== "voice") {
      throw Errors.invalidInput("Voice test requires a voice agent");
    }
    if (a.agentPlatform !== "livekit") {
      throw Errors.invalidInput(
        "Voice test is only supported for LiveKit agents",
      );
    }
    return a;
  });

  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  const lkMeta = (meta.livekit ?? {}) as Record<string, unknown>;
  const livekitUrl = lkMeta.url as string | undefined;
  const agentName = lkMeta.agentName as string | undefined;

  if (!livekitUrl || !agentName) {
    throw Errors.invalidInput(
      "LiveKit is not configured for this agent. Configure it first.",
    );
  }

  const apiKey = await getAgentSecretByType(orgId, agentId, "livekit_api_key");
  const apiSecret = await getAgentSecretByType(
    orgId,
    agentId,
    "livekit_api_secret",
  );

  if (!apiKey || !apiSecret) {
    throw Errors.invalidInput(
      "LiveKit credentials not found. Re-configure LiveKit for this agent.",
    );
  }

  const roomName = `voice-test-${nanoid()}`;
  const identity = `user-${caller.userId.slice(0, 8)}-${nanoid(6)}`;

  // Record a session before we dispatch so we can attribute the call even if
  // dispatch fails or the caller never connects.
  const session = await createSession(orgId, agentId, {
    channelType: "voice",
    userIdentifier: caller.email,
    userMetadata: {
      voiceTest: true,
      userId: caller.userId,
      name: caller.name,
      roomName,
    },
  });

  const dispatchMetadata = buildVoiceTestDispatchMetadata({
    agentSlug: agent.slug,
    sessionId: session.id,
    callerEmail: caller.email,
  });

  let dispatchId: string;
  try {
    dispatchId = await dispatchAgentToRoom(
      livekitUrl,
      apiKey,
      apiSecret,
      agentName,
      roomName,
      dispatchMetadata,
    );
  } catch (err) {
    // Roll the session forward so the dashboard doesn't collect orphan
    // "initiated" rows when LiveKit dispatch fails (bad creds, worker offline,
    // network blip). updateSession is RLS-scoped so this can't cross orgs.
    // Nested try so a rollback failure doesn't shadow the real dispatch error
    // — the caller needs to see the LiveKit failure, not a secondary DB blip.
    try {
      await updateSession(orgId, session.id, agentId, { status: "abandoned" });
    } catch (rollbackErr) {
      getLogger().error(
        { orgId, agentId, sessionId: session.id, rollbackErr },
        "failed to abandon voice-test session after dispatch failure",
      );
    }
    throw err;
  }

  const token = await generateVoiceTestToken({
    apiKey,
    apiSecret,
    roomName,
    identity,
    name: caller.name,
  });

  // Correlation breadcrumb. Pairs with the worker-side "Client ready for
  // agent …" log so triaging a failed "Talk to agent" click is one grep
  // across roomName / dispatchId.
  getLogger().info(
    {
      orgId,
      agentId,
      sessionId: session.id,
      dispatchId,
      roomName,
      agentName,
      profileName: agent.slug,
    },
    "voice-test dispatched",
  );

  return {
    livekitUrl,
    roomName,
    token,
    sessionId: session.id,
    dispatchId,
    agentName,
    profileName: agent.slug,
    identity,
  };
}

// ============================================================================
// Voice Prototype (browser WebRTC + compiled prompt injected via metadata)
//
// This is the prototype counterpart to the production "Voice Test" flow
// above. The contract — and the rationale for keeping them as separate code
// paths — is documented in ADR-015. Short version: the prototype injects the
// agent's compiled prompt into dispatch metadata so an admin can iterate on
// a prompt and immediately hear it without redeploying a worker profile.
// ============================================================================

const PROTOTYPE_AGENT_WORKER = "voice-prototype";

/**
 * Build the dispatch-metadata payload for a voice-prototype session.
 *
 * Mirrors the contract enforced on the Python side by
 * ``prompt_agent.parse_dispatch_metadata`` — if either side drifts, dispatched
 * calls silently land in a worker that refuses them. The contract test on the
 * TS side is ``tests/unit/agents/voice-prototype-dispatch.test.ts``; on the
 * Python side it's ``tests/test_prompt_agent.py::TestParseDispatchMetadata``.
 */
export function buildVoicePrototypeDispatchMetadata(input: {
  agentId: string;
  agentSlug: string;
  sessionId: string;
  callerEmail: string;
  compiledPrompt: string;
}): {
  mode: "voice-prototype";
  agentName: string;
  agent_id: string;
  session_id: string;
  user_identifier: string;
  email: string;
  compiled_prompt: string;
} {
  if (!input.compiledPrompt || !input.compiledPrompt.trim()) {
    throw Errors.invalidInput(
      "Voice prototype requires a non-empty compiled prompt — compile the agent first.",
    );
  }

  return {
    mode: "voice-prototype" as const,
    agentName: input.agentSlug,
    agent_id: input.agentId,
    session_id: input.sessionId,
    user_identifier: input.callerEmail,
    email: input.callerEmail,
    compiled_prompt: input.compiledPrompt,
  };
}

export interface VoicePrototypeSession {
  livekitUrl: string;
  roomName: string;
  token: string;
  sessionId: string;
  dispatchId: string;
  agentName: string;
  identity: string;
  promptChars: number;
}

export async function createVoicePrototypeSession(
  orgId: string,
  agentId: string,
  caller: { userId: string; email: string; name: string },
): Promise<VoicePrototypeSession> {
  const agent = await forOrg(orgId, async (tx) => {
    const a = await requireAgent(tx, agentId);
    if (!a.isActive) {
      throw Errors.invalidInput("Agent is not active");
    }
    if (a.modality !== "voice") {
      throw Errors.invalidInput("Voice prototype requires a voice agent");
    }
    if (a.agentPlatform !== "livekit") {
      throw Errors.invalidInput(
        "Voice prototype is only supported for LiveKit agents",
      );
    }
    if (!a.compiledInstructions || !a.compiledInstructions.trim()) {
      throw Errors.invalidInput(
        "Agent has no compiled prompt — compile the prompt before testing.",
      );
    }
    return a;
  });

  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  const lkMeta = (meta.livekit ?? {}) as Record<string, unknown>;
  const livekitUrl = lkMeta.url as string | undefined;

  if (!livekitUrl) {
    throw Errors.invalidInput(
      "LiveKit URL is not configured for this agent. Configure it first.",
    );
  }

  const apiKey = await getAgentSecretByType(orgId, agentId, "livekit_api_key");
  const apiSecret = await getAgentSecretByType(
    orgId,
    agentId,
    "livekit_api_secret",
  );

  if (!apiKey || !apiSecret) {
    throw Errors.invalidInput(
      "LiveKit credentials not found. Re-configure LiveKit for this agent.",
    );
  }

  const roomName = `voice-prototype-${nanoid()}`;
  const identity = `user-${caller.userId.slice(0, 8)}-${nanoid(6)}`;

  // Create the session row first so a failed dispatch still gets attributed
  // and rolled forward (same pattern as createVoiceTestSession).
  const session = await createSession(orgId, agentId, {
    channelType: "voice",
    userIdentifier: caller.email,
    userMetadata: {
      voicePrototype: true,
      userId: caller.userId,
      name: caller.name,
      roomName,
    },
  });

  // compiledInstructions is non-null here — guarded above inside forOrg.
  const compiledPrompt = agent.compiledInstructions as string;

  const dispatchMetadata = buildVoicePrototypeDispatchMetadata({
    agentId: agent.id,
    agentSlug: agent.slug,
    sessionId: session.id,
    callerEmail: caller.email,
    compiledPrompt,
  });

  let dispatchId: string;
  try {
    dispatchId = await dispatchAgentToRoom(
      livekitUrl,
      apiKey,
      apiSecret,
      PROTOTYPE_AGENT_WORKER,
      roomName,
      dispatchMetadata,
    );
  } catch (err) {
    try {
      await updateSession(orgId, session.id, agentId, { status: "abandoned" });
    } catch (rollbackErr) {
      getLogger().error(
        { orgId, agentId, sessionId: session.id, rollbackErr },
        "failed to abandon voice-prototype session after dispatch failure",
      );
    }
    throw err;
  }

  const token = await generateVoiceTestToken({
    apiKey,
    apiSecret,
    roomName,
    identity,
    name: caller.name,
  });

  getLogger().info(
    {
      orgId,
      agentId,
      sessionId: session.id,
      dispatchId,
      roomName,
      promptChars: compiledPrompt.length,
    },
    "voice-prototype dispatched",
  );

  return {
    livekitUrl,
    roomName,
    token,
    sessionId: session.id,
    dispatchId,
    agentName: PROTOTYPE_AGENT_WORKER,
    identity,
    promptChars: compiledPrompt.length,
  };
}
