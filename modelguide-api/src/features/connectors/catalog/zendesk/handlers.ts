/**
 * Zendesk Support API v2 tool handlers.
 * Each handler creates a fetcher from ctx.config and calls the appropriate endpoint.
 */

import { withConnector } from "../lib/http-client";
import { createZendeskFetcher } from "./client";

const withZendesk = withConnector(createZendeskFetcher);

function requirePositiveInt(value: unknown, name: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return num;
}

export const listTickets = withZendesk(async (fetcher, ctx) => {
  const input = ctx.input as {
    page?: number;
    perPage?: number;
    sortBy?: string;
    sortOrder?: string;
  };
  const data = await fetcher<Record<string, unknown>>("/tickets.json", {
    params: {
      page: input.page,
      per_page: input.perPage,
      sort_by: input.sortBy,
      sort_order: input.sortOrder,
    },
  });
  return { success: true, data };
});

export const getTicket = withZendesk(async (fetcher, ctx) => {
  const ticketId = requirePositiveInt(ctx.input.ticketId, "ticketId");
  const data = await fetcher<Record<string, unknown>>(
    `/tickets/${ticketId}.json`,
  );
  return { success: true, data };
});

export const createTicket = withZendesk(async (fetcher, ctx) => {
  const input = ctx.input as {
    subject: string;
    body: string;
    priority?: string;
    type?: string;
    tags?: string[];
    requesterEmail?: string;
    requesterName?: string;
  };

  const ticket: Record<string, unknown> = {
    subject: input.subject,
    comment: { body: input.body },
  };

  if (input.priority !== undefined) ticket.priority = input.priority;
  if (input.type !== undefined) ticket.type = input.type;
  if (input.tags !== undefined) ticket.tags = input.tags;

  // Requester is optional — when omitted, Zendesk attributes the ticket
  // to the authenticated API user (anonymous ticket drop).
  if (input.requesterEmail || input.requesterName) {
    const requester: Record<string, string> = {};
    if (input.requesterEmail) requester.email = input.requesterEmail;
    if (input.requesterName) requester.name = input.requesterName;
    ticket.requester = requester;
  }

  const data = await fetcher<Record<string, unknown>>("/tickets.json", {
    method: "POST",
    body: { ticket },
  });
  return { success: true, data };
});

export const updateTicket = withZendesk(async (fetcher, ctx) => {
  const input = ctx.input as {
    ticketId: number;
    status?: string;
    priority?: string;
    type?: string;
    subject?: string;
    tags?: string[];
    assigneeId?: number;
  };

  const ticketId = requirePositiveInt(input.ticketId, "ticketId");

  const ticket: Record<string, unknown> = {};
  if (input.status !== undefined) ticket.status = input.status;
  if (input.priority !== undefined) ticket.priority = input.priority;
  if (input.type !== undefined) ticket.type = input.type;
  if (input.subject !== undefined) ticket.subject = input.subject;
  if (input.tags !== undefined) ticket.tags = input.tags;
  if (input.assigneeId !== undefined) ticket.assignee_id = input.assigneeId;

  const data = await fetcher<Record<string, unknown>>(
    `/tickets/${ticketId}.json`,
    {
      method: "PUT",
      body: { ticket },
    },
  );
  return { success: true, data };
});

export const addComment = withZendesk(async (fetcher, ctx) => {
  const input = ctx.input as {
    ticketId: number;
    body: string;
    public?: boolean;
  };

  const ticketId = requirePositiveInt(input.ticketId, "ticketId");

  const data = await fetcher<Record<string, unknown>>(
    `/tickets/${ticketId}.json`,
    {
      method: "PUT",
      body: {
        ticket: {
          comment: {
            body: input.body,
            public: input.public ?? true,
          },
        },
      },
    },
  );
  return { success: true, data };
});

export const searchTickets = withZendesk(async (fetcher, ctx) => {
  const input = ctx.input as {
    query: string;
    sortBy?: string;
    sortOrder?: string;
  };

  const data = await fetcher<Record<string, unknown>>("/search.json", {
    params: {
      query: `type:ticket ${input.query}`,
      sort_by: input.sortBy,
      sort_order: input.sortOrder,
    },
  });
  return { success: true, data };
});

export const listTicketComments = withZendesk(async (fetcher, ctx) => {
  const input = ctx.input as {
    ticketId: number;
    page?: number;
    perPage?: number;
  };

  const ticketId = requirePositiveInt(input.ticketId, "ticketId");

  const data = await fetcher<Record<string, unknown>>(
    `/tickets/${ticketId}/comments.json`,
    {
      params: {
        page: input.page,
        per_page: input.perPage,
      },
    },
  );
  return { success: true, data };
});

export const getUser = withZendesk(async (fetcher, ctx) => {
  const userId = requirePositiveInt(ctx.input.userId, "userId");
  const data = await fetcher<Record<string, unknown>>(`/users/${userId}.json`);
  return { success: true, data };
});
