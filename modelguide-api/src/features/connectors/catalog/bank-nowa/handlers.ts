/**
 * Bank Nowa mock connector handlers.
 * All responses are hardcoded fixtures — no real banking API is called.
 * Used for the ModelGuide sales demo (Bank Nowa S.A.).
 */

import type { ToolExecutionContext, ToolExecutionResult } from "../types";

export async function verifyCustomer(
  _ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  return {
    success: true,
    data: {
      success: true,
      customer_id: "CUST-001",
      card_id: "CARD-001",
      name: "Jan Nowak",
      address: "ul. Marszałkowska 42/7, 00-024 Warszawa",
    },
  };
}

export async function lookupTransaction(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const { amount } = ctx.input as { amount?: number | string; date?: string };

  if (amount === undefined || amount === null) {
    return {
      success: false,
      data: { error: "amount is required to look up a transaction" },
    };
  }

  // Return Żabka fixture for small amounts, DigiShop24 for everything else
  const numAmount =
    typeof amount === "string" ? Number.parseFloat(amount) : amount;

  if (Number.isNaN(numAmount) || numAmount <= 100) {
    return {
      success: true,
      data: {
        transaction_id: "TXN-879",
        merchant: "Żabka",
        amount: 85.5,
        currency: "PLN",
        date: "2026-04-11",
        card_id: "CARD-001",
      },
    };
  }

  return {
    success: true,
    data: {
      transaction_id: "TXN-881",
      merchant: "DigiShop24.com",
      amount: 450,
      currency: "PLN",
      date: "2026-04-12",
      card_id: "CARD-001",
    },
  };
}

export async function checkStandingOrders(
  _ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  return {
    success: true,
    data: {
      standing_orders: [
        {
          name: "Rata kredytu hipotecznego",
          amount: 3200,
          currency: "PLN",
          next_date: "2026-04-25",
        },
        {
          name: "Ubezpieczenie mieszkania",
          amount: 189,
          currency: "PLN",
          next_date: "2026-04-30",
        },
      ],
    },
  };
}

export async function blockCard(
  _ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  return {
    success: true,
    data: {
      success: true,
      card_id: "CARD-001",
      blocked_at: new Date().toISOString(),
    },
  };
}

export async function createDispute(
  _ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  return {
    success: true,
    data: {
      dispute_id: "DISP-001",
      status: "opened",
      estimated_resolution: "do 14 dni roboczych",
    },
  };
}

export async function orderNewCard(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const { card_type, delivery_address } = ctx.input as {
    card_type?: string;
    delivery_address?: string;
  };

  const isExpress =
    typeof card_type === "string" && card_type.toLowerCase().includes("expres");

  return {
    success: true,
    data: {
      order_id: "ORD-001",
      card_type: card_type ?? "standard",
      delivery_address:
        delivery_address ?? "ul. Marszałkowska 42/7, 00-024 Warszawa",
      estimated_delivery: isExpress ? "2 dni robocze" : "5-7 dni roboczych",
    },
  };
}
