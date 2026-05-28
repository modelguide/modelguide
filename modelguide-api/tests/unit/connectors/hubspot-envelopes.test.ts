/**
 * Per-tool signal envelope construction (Phase 0 §1.1, HubSpot spec §5).
 *
 * Locks for every emitting tool:
 *   - event_type
 *   - canonical_object_identity ({tenant_id, source_system, object_type, object_id})
 *   - declared_lens_hints (canonical snake_case lens IDs)
 *   - entity.{type, id}
 *
 * Does NOT test enqueue wiring — that's covered by hubspot-mode-b-wiring.test.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  EMITTING_TOOL_EVENT_TYPES,
  type EmissionConfig,
  type EmittingToolName,
  buildEnvelopeForTool,
} from "@features/connectors/catalog/hubspot/ingest/mode-b/envelopes";
import type { ToolExecutionContext } from "@features/connectors/catalog/types";
import type { LensId } from "@features/lorevault/client";
import { FIXTURE_IDS } from "@features/lorevault/fixtures";

const EMISSION_CONFIG: EmissionConfig = {
  knowledgeSpaceId: FIXTURE_IDS.knowledgeSpaceId,
  vaultId: FIXTURE_IDS.vaultId,
  sourceInstance: "98765",
};

function makeCtx(input: Record<string, unknown> = {}): ToolExecutionContext {
  return {
    config: { portalId: "98765" },
    input,
    organizationId: "org-1",
    connectorId: "conn-1",
  };
}

interface ToolFixture {
  toolName: EmittingToolName;
  ctx: ToolExecutionContext;
  result: Record<string, unknown>;
  expected: {
    eventType: string;
    entityType: string;
    entityId: string;
    lensHints: LensId[];
  };
}

const FIXTURES: ToolFixture[] = [
  {
    toolName: "Create Contact",
    ctx: makeCtx({ properties: { firstname: "Ada", email: "ada@x.com" } }),
    result: { id: "c1", properties: { firstname: "Ada" } },
    expected: {
      eventType: "contact.created",
      entityType: "contact",
      entityId: "c1",
      lensHints: ["customer_interaction"],
    },
  },
  {
    toolName: "Update Contact",
    ctx: makeCtx({
      contactId: "c1",
      properties: { firstname: "Ada", lifecyclestage: "customer" },
    }),
    result: { id: "c1", properties: { firstname: "Ada" } },
    expected: {
      eventType: "contact.updated",
      entityType: "contact",
      entityId: "c1",
      // lifecyclestage in properties_changed adds revenue_intelligence
      lensHints: ["customer_interaction", "revenue_intelligence"],
    },
  },
  {
    toolName: "Create Deal",
    ctx: makeCtx({ properties: { dealname: "D-1" } }),
    result: { id: "d1", properties: { dealname: "D-1" } },
    expected: {
      eventType: "deal.created",
      entityType: "deal",
      entityId: "d1",
      lensHints: ["revenue_intelligence"],
    },
  },
  {
    toolName: "Update Deal Stage",
    ctx: makeCtx({ dealId: "d1", stage: "closedwon" }),
    result: { id: "d1", properties: { dealstage: "closedwon" } },
    expected: {
      eventType: "deal.stage_changed",
      entityType: "deal",
      entityId: "d1",
      lensHints: ["revenue_intelligence", "operational_workflow"],
    },
  },
  {
    toolName: "Create Ticket",
    ctx: makeCtx({ properties: { subject: "Login failure" } }),
    result: { id: "t1", properties: { subject: "Login failure" } },
    expected: {
      eventType: "ticket.created",
      entityType: "ticket",
      entityId: "t1",
      lensHints: ["customer_interaction", "operational_workflow"],
    },
  },
  {
    toolName: "Update Ticket",
    ctx: makeCtx({ ticketId: "t1", properties: { subject: "Updated" } }),
    result: { id: "t1", properties: { subject: "Updated" } },
    expected: {
      eventType: "ticket.updated",
      entityType: "ticket",
      entityId: "t1",
      lensHints: ["operational_workflow"],
    },
  },
  {
    toolName: "Close Ticket",
    ctx: makeCtx({ ticketId: "t1" }),
    result: { id: "t1", properties: { hs_pipeline_stage: "closed_stage" } },
    expected: {
      eventType: "ticket.closed",
      entityType: "ticket",
      entityId: "t1",
      lensHints: ["operational_workflow", "customer_interaction"],
    },
  },
  {
    toolName: "Add Reply To Ticket",
    ctx: makeCtx({ ticketId: "t1", text: "Investigating" }),
    result: { id: "msg1" },
    expected: {
      eventType: "ticket.reply_sent",
      entityType: "ticket",
      entityId: "t1",
      lensHints: ["customer_interaction", "knowledge_integrity"],
    },
  },
  {
    toolName: "Log Call Engagement",
    ctx: makeCtx({ properties: { hs_call_title: "Onboarding call" } }),
    result: { id: "call1", properties: {} },
    expected: {
      eventType: "call.logged",
      entityType: "engagement",
      entityId: "call1",
      lensHints: ["customer_interaction", "operational_workflow"],
    },
  },
  {
    toolName: "Create Note",
    ctx: makeCtx({ properties: { hs_note_body: "HITL handoff" } }),
    result: { id: "note1", properties: {} },
    expected: {
      eventType: "note.created",
      entityType: "note",
      entityId: "note1",
      lensHints: ["knowledge_integrity", "operational_workflow"],
    },
  },
];

describe("EMITTING_TOOL_EVENT_TYPES surface", () => {
  test("declares exactly the per-row spec §5 set", () => {
    const names = Object.keys(EMITTING_TOOL_EVENT_TYPES).sort();
    expect(names).toEqual(
      [
        "Add Reply To Ticket",
        "Close Ticket",
        "Create Contact",
        "Create Deal",
        "Create Note",
        "Create Ticket",
        "Log Call Engagement",
        "Update Contact",
        "Update Deal Stage",
        "Update Ticket",
      ].sort(),
    );
  });
});

describe("Per-tool envelope construction", () => {
  for (const fx of FIXTURES) {
    test(`${fx.toolName} → ${fx.expected.eventType}`, () => {
      const env = buildEnvelopeForTool(fx.toolName, {
        ctx: fx.ctx,
        result: fx.result,
        config: EMISSION_CONFIG,
        signalId: "sig_test",
        emittedAt: "2026-05-28T00:00:00.000Z",
      });
      expect(env).not.toBeNull();
      if (!env) return;

      expect(env.event_type).toBe(fx.expected.eventType);
      expect(env.signal_id).toBe("sig_test");
      expect(env.signal_version).toBe("1");
      expect(env.emitted_at).toBe("2026-05-28T00:00:00.000Z");
      expect(env.source_system).toBe("hubspot");
      expect(env.source_instance).toBe("98765");
      expect(env.knowledge_space_id).toBe(FIXTURE_IDS.knowledgeSpaceId);
      expect(env.vault_id).toBe(FIXTURE_IDS.vaultId);

      expect(env.entity.type).toBe(fx.expected.entityType);
      expect(env.entity.id).toBe(fx.expected.entityId);

      expect(env.canonical_object_identity).toEqual({
        tenant_id: FIXTURE_IDS.vaultId,
        source_system: "hubspot",
        object_type: fx.expected.entityType,
        object_id: fx.expected.entityId,
      });

      expect([...env.declared_lens_hints].sort()).toEqual(
        [...fx.expected.lensHints].sort(),
      );
    });
  }

  test("Update Contact omits revenue_intelligence when lifecyclestage not changed", () => {
    const env = buildEnvelopeForTool("Update Contact", {
      ctx: makeCtx({
        contactId: "c1",
        properties: { firstname: "Ada" },
      }),
      result: { id: "c1", properties: {} },
      config: EMISSION_CONFIG,
    });
    expect(env?.declared_lens_hints).toEqual(["customer_interaction"]);
  });

  test("signal_id defaults to a UUID v4 string", () => {
    const env = buildEnvelopeForTool("Create Contact", {
      ctx: makeCtx({ properties: { firstname: "Ada" } }),
      result: { id: "c1", properties: {} },
      config: EMISSION_CONFIG,
    });
    expect(env?.signal_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
