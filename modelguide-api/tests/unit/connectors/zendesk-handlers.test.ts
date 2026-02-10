/**
 * Unit tests for Zendesk connector handlers.
 * Mocks globalThis.fetch to verify correct API calls without a real Zendesk server.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ToolExecutionContext } from "@features/connectors/catalog/types";
import {
  addComment,
  createTicket,
  getTicket,
  getUser,
  listTicketComments,
  listTickets,
  searchTickets,
  updateTicket,
} from "@features/connectors/catalog/zendesk/handlers";

const BASE_CONFIG: Record<string, string> = {
  subdomain: "test-company",
  email: "agent@test.com",
  apiToken: "test_token_abc123",
};

const EXPECTED_AUTH = `Basic ${btoa("agent@test.com/token:test_token_abc123")}`;

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

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockFetchSuccess(responseData: Record<string, unknown>) {
  fetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  globalThis.fetch = fetchMock as typeof fetch;
}

function mockFetchError(status: number, body: string) {
  fetchMock = mock(() => Promise.resolve(new Response(body, { status })));
  globalThis.fetch = fetchMock as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Zendesk handlers", () => {
  // ----------------------------------------------------------------
  // List Tickets
  // ----------------------------------------------------------------
  describe("listTickets", () => {
    test("calls GET /tickets.json", async () => {
      mockFetchSuccess({ tickets: [], count: 0 });
      const result = await listTickets(makeCtx());
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test-company.zendesk.com/api/v2/tickets.json");
      expect(opts.method).toBe("GET");
    });

    test("uses Basic auth header", async () => {
      mockFetchSuccess({ tickets: [] });
      await listTickets(makeCtx());

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers.Authorization).toBe(EXPECTED_AUTH);
    });

    test("passes pagination params", async () => {
      mockFetchSuccess({ tickets: [] });
      await listTickets(makeCtx({ page: 2, perPage: 25 }));

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("page=2");
      expect(url).toContain("per_page=25");
    });
  });

  // ----------------------------------------------------------------
  // Get Ticket
  // ----------------------------------------------------------------
  describe("getTicket", () => {
    test("calls GET /tickets/:id.json", async () => {
      mockFetchSuccess({ ticket: { id: 123 } });
      const result = await getTicket(makeCtx({ ticketId: 123 }));
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://test-company.zendesk.com/api/v2/tickets/123.json",
      );
      expect(opts.method).toBe("GET");
    });
  });

  // ----------------------------------------------------------------
  // Create Ticket
  // ----------------------------------------------------------------
  describe("createTicket", () => {
    test("calls POST /tickets.json with subject and body", async () => {
      mockFetchSuccess({ ticket: { id: 456 } });
      const result = await createTicket(
        makeCtx({ subject: "Test issue", body: "Description here" }),
      );
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test-company.zendesk.com/api/v2/tickets.json");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.ticket.subject).toBe("Test issue");
      expect(body.ticket.comment.body).toBe("Description here");
    });

    test("includes requester when email provided", async () => {
      mockFetchSuccess({ ticket: { id: 456 } });
      await createTicket(
        makeCtx({
          subject: "Test",
          body: "Body",
          requesterEmail: "customer@example.com",
          requesterName: "Jane Doe",
        }),
      );

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.ticket.requester.email).toBe("customer@example.com");
      expect(body.ticket.requester.name).toBe("Jane Doe");
    });

    test("omits requester for anonymous ticket drop", async () => {
      mockFetchSuccess({ ticket: { id: 789 } });
      await createTicket(
        makeCtx({ subject: "Anonymous", body: "No requester" }),
      );

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.ticket.requester).toBeUndefined();
    });

    test("includes optional fields when provided", async () => {
      mockFetchSuccess({ ticket: { id: 456 } });
      await createTicket(
        makeCtx({
          subject: "Urgent",
          body: "Fix now",
          priority: "urgent",
          type: "incident",
          tags: ["vip", "billing"],
        }),
      );

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.ticket.priority).toBe("urgent");
      expect(body.ticket.type).toBe("incident");
      expect(body.ticket.tags).toEqual(["vip", "billing"]);
    });
  });

  // ----------------------------------------------------------------
  // Update Ticket
  // ----------------------------------------------------------------
  describe("updateTicket", () => {
    test("calls PUT /tickets/:id.json", async () => {
      mockFetchSuccess({ ticket: { id: 123, status: "solved" } });
      const result = await updateTicket(
        makeCtx({ ticketId: 123, status: "solved" }),
      );
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://test-company.zendesk.com/api/v2/tickets/123.json",
      );
      expect(opts.method).toBe("PUT");
      const body = JSON.parse(opts.body);
      expect(body.ticket.status).toBe("solved");
    });

    test("includes assignee_id when provided", async () => {
      mockFetchSuccess({ ticket: { id: 123 } });
      await updateTicket(makeCtx({ ticketId: 123, assigneeId: 999 }));

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.ticket.assignee_id).toBe(999);
    });
  });

  // ----------------------------------------------------------------
  // Add Comment
  // ----------------------------------------------------------------
  describe("addComment", () => {
    test("calls PUT /tickets/:id.json with comment payload", async () => {
      mockFetchSuccess({ ticket: { id: 123 } });
      const result = await addComment(
        makeCtx({ ticketId: 123, body: "Follow up note" }),
      );
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://test-company.zendesk.com/api/v2/tickets/123.json",
      );
      expect(opts.method).toBe("PUT");
      const body = JSON.parse(opts.body);
      expect(body.ticket.comment.body).toBe("Follow up note");
      expect(body.ticket.comment.public).toBe(true);
    });

    test("supports internal notes with public=false", async () => {
      mockFetchSuccess({ ticket: { id: 123 } });
      await addComment(
        makeCtx({ ticketId: 123, body: "Internal note", public: false }),
      );

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.ticket.comment.public).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // Search Tickets
  // ----------------------------------------------------------------
  describe("searchTickets", () => {
    test("calls GET /search.json with type:ticket prefix", async () => {
      mockFetchSuccess({ results: [], count: 0 });
      const result = await searchTickets(
        makeCtx({ query: "status:open priority:urgent" }),
      );
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("/search.json");
      expect(url).toContain("type%3Aticket");
      expect(url).toContain("status%3Aopen");
      expect(opts.method).toBe("GET");
    });
  });

  // ----------------------------------------------------------------
  // List Ticket Comments
  // ----------------------------------------------------------------
  describe("listTicketComments", () => {
    test("calls GET /tickets/:id/comments.json", async () => {
      mockFetchSuccess({ comments: [], count: 0 });
      const result = await listTicketComments(makeCtx({ ticketId: 123 }));
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://test-company.zendesk.com/api/v2/tickets/123/comments.json",
      );
      expect(opts.method).toBe("GET");
    });
  });

  // ----------------------------------------------------------------
  // Get User
  // ----------------------------------------------------------------
  describe("getUser", () => {
    test("calls GET /users/:id.json", async () => {
      mockFetchSuccess({ user: { id: 456, name: "Test User" } });
      const result = await getUser(makeCtx({ userId: 456 }));
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://test-company.zendesk.com/api/v2/users/456.json",
      );
      expect(opts.method).toBe("GET");
    });
  });

  // ----------------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------------
  describe("error handling", () => {
    test("returns error on API 404", async () => {
      mockFetchError(404, '{"error":"RecordNotFound"}');
      const result = await getTicket(makeCtx({ ticketId: 999999 }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("404");
    });

    test("returns error on API 500", async () => {
      mockFetchError(500, "Internal Server Error");
      const result = await listTickets(makeCtx());
      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    test("returns error when subdomain is missing", async () => {
      const result = await listTickets(
        makeCtx({}, { email: "a@b.com", apiToken: "tok" }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("subdomain");
    });

    test("returns error when email is missing", async () => {
      const result = await listTickets(
        makeCtx({}, { subdomain: "test", apiToken: "tok" }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("email");
    });

    test("returns error when apiToken is missing", async () => {
      const result = await listTickets(
        makeCtx({}, { subdomain: "test", email: "a@b.com" }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("apiToken");
    });

    test("returns error when subdomain contains invalid characters", async () => {
      const result = await listTickets(
        makeCtx(
          {},
          { subdomain: "evil.com/api#", email: "a@b.com", apiToken: "tok" },
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid characters");
    });

    test("returns error when ticketId is not a positive integer", async () => {
      mockFetchSuccess({ ticket: { id: 1 } });
      const result = await getTicket(makeCtx({ ticketId: "abc" }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("ticketId must be a positive integer");
    });

    test("returns error when userId is not a positive integer", async () => {
      mockFetchSuccess({ user: { id: 1 } });
      const result = await getUser(makeCtx({ userId: -5 }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("userId must be a positive integer");
    });

    test("returns error on network failure", async () => {
      fetchMock = mock(() => Promise.reject(new Error("Network error")));
      globalThis.fetch = fetchMock as typeof fetch;

      const result = await getTicket(makeCtx({ ticketId: 123 }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });
});
