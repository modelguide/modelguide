/**
 * import
 * Ad-hoc script to manage the ElevenLabs agent configuration.
 *
 * Simulates what a ModelGuide client (e.g. GlowBox Beauty) would do:
 * - Fetch agent config
 * - Update prompt, tools, and dynamic variables
 *
 * Usage (from examples/elevenlabs-agent/):
 *   bun run manage-agent.ts get
 *   bun run manage-agent.ts update
 *
 * Reads .env from the script's directory automatically.
 */

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type * as ElevenLabs from "@elevenlabs/elevenlabs-js/api";
import fs from "fs";

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const AGENT_ID = "agent_3501kgq8y9nre61vhwb60nyc0fnt";

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;
const MG_API_KEY = process.env.MG_API_KEY ?? "";

// ============================================================================
// Agent prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a friendly GlowBox Beauty voice concierge. You help customers find skincare and beauty products, place orders, check order status, and handle returns.

## Rules
- Be concise and natural — this is a voice conversation.
- Always confirm before placing or modifying an order.
- If you can't find a product, suggest alternatives from the catalog.
- If something goes wrong with a tool call, apologize and try once more.

## Available tools
You have access to tools prefixed with "glowbox_store_". Use them to:
- Search and browse products
- Add products to cart
- View cart contents
- Create and confirm orders
- Check order status`;

// ============================================================================
// Tool definitions — webhook tools pointing at ModelGuide
// ============================================================================

type PropType = "string" | "number" | "integer" | "boolean";

function webhookTool(
  name: string,
  description: string,
  properties: Record<
    string,
    { type: PropType; description?: string; enum?: string[] }
  >,
  required: string[],
): ElevenLabs.PromptAgentApiModelInputToolsItem {
  return {
    type: "webhook",
    name,
    description,
    responseTimeoutSecs: 30,
    apiSchema: {
      url: `${WEBHOOK_BASE_URL}/webhooks/elevenlabs/tool`,
      method: "POST",
      requestBodySchema: {
        type: "object",
        properties,
        required,
      },
    },
  };
}

const TOOLS: ElevenLabs.PromptAgentApiModelInputToolsItem[] = [
  webhookTool(
    "glowbox_store_add_to_cart",
    "Add an item to the customer's shopping cart",
    {
      product_id: {
        type: "string",
        description: "Product ID or handle (e.g. 'prod_cerave_hydrating_cleanser')",
      },
      quantity: { type: "number", description: "Number of items" },
      variant_id: {
        type: "string",
        description: "Variant ID for size/type selection",
      },
    },
    ["product_id", "quantity"],
  ),
  webhookTool(
    "glowbox_store_get_cart",
    "View the current cart contents and total",
    {},
    [],
  ),
  webhookTool(
    "glowbox_store_confirm_order",
    "Confirm and place the order. Always ask the customer to confirm first.",
    {
      delivery_address: {
        type: "string",
        description: "Full delivery address",
      },
    },
    ["delivery_address"],
  ),
  webhookTool(
    "glowbox_store_get_order",
    "Get details of an existing order by order ID",
    {
      order_id: { type: "string", description: "The order ID" },
    },
    ["order_id"],
  ),
];

// ============================================================================
// Commands
// ============================================================================

async function getAgent() {
  const agent = await client.conversationalAi.agents.get(AGENT_ID);
  console.log("\n=== Agent Config ===");
  console.log(JSON.stringify(agent, null, 2));
	fs.writeFileSync('get-agent-output.json', JSON.stringify(agent, null, 2));
}

async function updateAgent() {
  if (!WEBHOOK_BASE_URL) {
    console.error("ERROR: WEBHOOK_BASE_URL is not set in .env");
    process.exit(1);
  }

  console.log(`Updating agent ${AGENT_ID}...`);
  console.log(`  Webhook URL: ${WEBHOOK_BASE_URL}/webhooks/elevenlabs/tool`);
  console.log(`  mg_api_key: ${MG_API_KEY.slice(0, 8)}...`);
  console.log(`  Tools: ${TOOLS.map((t) => ("name" in t ? t.name : "?")).join(", ")}`);

  const agent = await client.conversationalAi.agents.update(AGENT_ID, {
    name: "GlowBox Voice Concierge",
    conversationConfig: {
      agent: {
        // prompt: {
        //   prompt: SYSTEM_PROMPT,
        //   tools: TOOLS,
        // },
        firstMessage:
          "Hi, welcome to GlowBox Beauty! How can I help you today?",
        language: "en",
        dynamicVariables: {
          dynamicVariablePlaceholders: {
            mg_api_key: MG_API_KEY,
          },
        },
      },
    },
  });

  console.log("\n=== Updated Agent ===");
  console.log(`Agent ID: ${agent.agentId}`);
  console.log("Done! Try calling the agent now.");
}

// ============================================================================
// CLI
// ============================================================================

const command = process.argv[2];

switch (command) {
  case "get":
    await getAgent();
    break;
  case "update":
    await updateAgent();
    break;
  default:
    console.log("Usage (run from examples/elevenlabs-agent/):");
    console.log("  bun run manage-agent.ts get      # Fetch current config");
    console.log("  bun run manage-agent.ts update   # Push new config");
    console.log("");
    console.log("Configure via .env:");
    console.log("  ELEVENLABS_API_KEY  — your ElevenLabs API key (required)");
    console.log("  WEBHOOK_BASE_URL    — your ngrok base URL (required for update)");
    console.log("  MG_API_KEY          — ModelGuide API key for the agent (mgk_xxx)");
}
