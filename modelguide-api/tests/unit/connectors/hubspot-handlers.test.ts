/**
 * HubSpot handler unit tests.
 *
 * Mocks globalThis.fetch and verifies:
 *   - Bearer auth header
 *   - 429 retry with Retry-After
 *   - Property allowlist enforcement on Update Contact and Update Ticket
 *   - Close Ticket resolves the per-pipeline CLOSED stage
 *   - Update Ticket rejects closed-stage moves
 *   - Add Reply To Ticket writes via the Conversations API
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  addReplyToTicket,
  closeTicket,
  getContactByEmail,
  updateContact,
  updateTicket,
} from "@features/connectors/catalog/hubspot/handlers";
import type { ToolExecutionContext } from "@features/connectors/catalog/types";

const BASE_CONFIG: Record<string, string> = {
  accessToken: "pat-test-abc123",
  portalId: "98765",
};

function makeCtx(
  input: Record<string, unknown> = {},
  config = BASE_CONFIG,
): ToolExecutionContext {
  return {
    config,
    input,
    organizationId: "org-1",
    connectorId: "conn-1",
  };
}

type FetchResponder = (
  url: string,
  init: RequestInit,
) => Response | Promise<Response>;

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];

function installFetch(
  responders: FetchResponder | FetchResponder[],
): ReturnType<typeof mock> {
  calls = [];
  const queue = Array.isArray(responders) ? [...responders] : null;
  const single = Array.isArray(responders) ? null : responders;
  const fetchMock = mock((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const responder = queue ? queue.shift() : single;
    if (!responder) {
      throw new Error(`Unexpected extra fetch call: ${url}`);
    }
    return Promise.resolve(responder(url, init));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Auth + base URL
// ---------------------------------------------------------------------------

describe("HubSpot auth + base URL", () => {
  test("sends Bearer access token and hits api.hubapi.com", async () => {
    installFetch(() => jsonResponse({ id: "1", properties: {} }));
    const result = await getContactByEmail(
      makeCtx({ email: "jane@example.com" }),
    );
    expect(result.success).toBe(true);
    expect(calls[0].url).toContain(
      "https://api.hubapi.com/crm/v3/objects/contacts/",
    );
    expect(calls[0].url).toContain("idProperty=email");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer pat-test-abc123");
  });

  test("missing accessToken yields success:false with a clear error", async () => {
    const result = await getContactByEmail(
      makeCtx({ email: "x@y.com" }, { portalId: "1" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("accessToken");
  });
});

// ---------------------------------------------------------------------------
// 429 backoff (Retry-After respected)
// ---------------------------------------------------------------------------

describe("HubSpot 429 backoff", () => {
  test("retries once on 429 then succeeds, respecting Retry-After=0", async () => {
    installFetch([
      () =>
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      () => jsonResponse({ id: "42", properties: {} }),
    ]);
    const result = await getContactByEmail(
      makeCtx({ email: "throttle@example.com" }),
    );
    expect(result.success).toBe(true);
    expect(calls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Update Contact — property allowlist
// ---------------------------------------------------------------------------

describe("Update Contact allowlist", () => {
  test("rejects non-allowlisted property before issuing a HubSpot call", async () => {
    installFetch(() => jsonResponse({ id: "1" }));
    const result = await updateContact(
      makeCtx({
        contactId: "1",
        properties: { firstname: "Ada", hs_object_source: "MANUAL" },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("hs_object_source");
    expect(calls.length).toBe(0);
  });

  test("PATCHes when all properties are allowlisted", async () => {
    installFetch(() =>
      jsonResponse({ id: "1", properties: { firstname: "Ada" } }),
    );
    const result = await updateContact(
      makeCtx({
        contactId: "1",
        properties: { firstname: "Ada", lifecyclestage: "customer" },
      }),
    );
    expect(result.success).toBe(true);
    expect(calls[0].init.method).toBe("PATCH");
  });
});

// ---------------------------------------------------------------------------
// Update Ticket — allowlist + closed-stage rejection
// ---------------------------------------------------------------------------

describe("Update Ticket governance", () => {
  test("rejects non-allowlisted property", async () => {
    installFetch(() => jsonResponse({}));
    const result = await updateTicket(
      makeCtx({
        ticketId: "10",
        properties: { subject: "ok", hs_object_id: "evil" },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("hs_object_id");
  });

  test("rejects an hs_pipeline_stage that resolves to a CLOSED stage", async () => {
    installFetch([
      // resolve current pipeline for the ticket
      () => jsonResponse({ id: "10", properties: { hs_pipeline: "p1" } }),
      // pipeline lookup
      () =>
        jsonResponse({
          id: "p1",
          label: "Service Pipeline",
          stages: [
            { id: "s_open", label: "Open", metadata: { ticketState: "OPEN" } },
            {
              id: "s_done",
              label: "Closed",
              metadata: { ticketState: "CLOSED" },
            },
          ],
        }),
    ]);

    const result = await updateTicket(
      makeCtx({
        ticketId: "10",
        properties: { hs_pipeline_stage: "s_done" },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Close Ticket");
  });

  test("allows an hs_pipeline_stage that resolves to an OPEN stage", async () => {
    installFetch([
      () => jsonResponse({ id: "10", properties: { hs_pipeline: "p1" } }),
      () =>
        jsonResponse({
          id: "p1",
          label: "Service Pipeline",
          stages: [
            { id: "s_open", label: "Open", metadata: { ticketState: "OPEN" } },
            {
              id: "s_done",
              label: "Closed",
              metadata: { ticketState: "CLOSED" },
            },
          ],
        }),
      // PATCH ticket
      () =>
        jsonResponse({
          id: "10",
          properties: { hs_pipeline_stage: "s_open" },
        }),
    ]);

    const result = await updateTicket(
      makeCtx({
        ticketId: "10",
        properties: { hs_pipeline_stage: "s_open" },
      }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Close Ticket — resolves CLOSED stage at runtime
// ---------------------------------------------------------------------------

describe("Close Ticket", () => {
  test("resolves the per-pipeline CLOSED stage and PATCHes the ticket", async () => {
    installFetch([
      () => jsonResponse({ id: "10", properties: { hs_pipeline: "p1" } }),
      () =>
        jsonResponse({
          id: "p1",
          label: "Service Pipeline",
          stages: [
            { id: "s_open", label: "Open", metadata: { ticketState: "OPEN" } },
            {
              id: "s_done",
              label: "Closed",
              metadata: { ticketState: "CLOSED" },
            },
          ],
        }),
      () =>
        jsonResponse({
          id: "10",
          properties: { hs_pipeline_stage: "s_done" },
        }),
    ]);
    const result = await closeTicket(makeCtx({ ticketId: "10" }));
    expect(result.success).toBe(true);

    const lastCall = calls[calls.length - 1];
    expect(lastCall.init.method).toBe("PATCH");
    const body = JSON.parse(String(lastCall.init.body));
    expect(body.properties.hs_pipeline_stage).toBe("s_done");
  });

  test("errors clearly when the pipeline has no closed stage configured", async () => {
    installFetch([
      () => jsonResponse({ id: "10", properties: { hs_pipeline: "p1" } }),
      () =>
        jsonResponse({
          id: "p1",
          label: "Pipeline",
          stages: [
            {
              id: "s_open",
              label: "Open",
              metadata: { ticketState: "OPEN" },
            },
          ],
        }),
    ]);
    const result = await closeTicket(makeCtx({ ticketId: "10" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("CLOSED");
  });
});

// ---------------------------------------------------------------------------
// Add Reply To Ticket — uses Conversations API
// ---------------------------------------------------------------------------

describe("Add Reply To Ticket", () => {
  test("errors clearly when the ticket has no associated thread", async () => {
    installFetch([
      // ticket properties read (hs_thread_ids)
      () => jsonResponse({ id: "10", properties: {} }),
      // fallback associations endpoint
      () => jsonResponse({ results: [] }),
    ]);
    const result = await addReplyToTicket(
      makeCtx({ ticketId: "10", text: "hello" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("no associated conversation thread");
  });

  test("POSTs to /conversations/v3/conversations/threads/.../messages", async () => {
    installFetch([
      // ticket properties: hs_thread_ids
      () =>
        jsonResponse({
          id: "10",
          properties: { hs_thread_ids: "thr_123" },
        }),
      // thread read
      () =>
        jsonResponse({
          id: "thr_123",
          channelId: "1000",
          channelAccountId: "acct_email_1",
          latestMessageReceivedTimestamp: "2026-05-27T12:00:00Z",
        }),
      // message history
      () =>
        jsonResponse({
          results: [
            {
              id: "m_in",
              type: "MESSAGE",
              direction: "INCOMING",
              channelId: "1000",
              channelAccountId: "acct_email_1",
              senders: [
                { name: "Customer", deliveryIdentifier: { value: "c@x.com" } },
              ],
              recipients: [
                { deliveryIdentifier: { value: "support@aura.example" } },
              ],
              subject: "Re: Login failure",
              createdAt: "2026-05-27T12:00:00Z",
            },
          ],
        }),
      // POST reply
      () => jsonResponse({ id: "m_out", type: "MESSAGE" }),
    ]);

    const result = await addReplyToTicket(
      makeCtx({ ticketId: "10", text: "Investigating now" }),
    );
    expect(result.success).toBe(true);

    const last = calls[calls.length - 1];
    expect(last.url).toContain(
      "/conversations/v3/conversations/threads/thr_123/messages",
    );
    expect(last.init.method).toBe("POST");
    const body = JSON.parse(String(last.init.body));
    expect(body.channelId).toBe("1000");
    expect(body.channelAccountId).toBe("acct_email_1");
    expect(body.text).toBe("Investigating now");
  });
});
