/**
 * Ad-hoc script to manage the ElevenLabs agent configuration.
 *
 * Simulates what a ModelGuide client (e.g. Pizza Palace) would do:
 * - Fetch agent config
 * - Update prompt, tools, and dynamic variables
 *
 * Usage:
 *   bun run examples/elevenlabs-agent/manage-agent.ts get
 *   bun run examples/elevenlabs-agent/manage-agent.ts update
 */

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient();

const AGENT_ID = "agent_3501kgq8y9nre61vhwb60nyc0fnt";

// Your ngrok URL — update this each time you restart ngrok
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_URL ?? "https://YOUR_NGROK_URL_HERE";

// The ModelGuide API key for the Pizza Palace agent (from seed data)
const MG_API_KEY = process.env.MG_API_KEY ?? "mgk_REPLACE_WITH_YOUR_KEY";

// ============================================================================
// Agent prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a friendly Pizza Palace voice assistant. You help customers place orders, check order status, and modify existing orders.

## Rules
- Be concise and natural — this is a voice conversation.
- Always confirm before placing or modifying an order.
- If you can't find an item, suggest alternatives.
- If something goes wrong with a tool call, apologize and try once more.

## Available tools
You have access to tools prefixed with "pizzapalace_". Use them to:
- Add items to cart
- View cart contents  
- Create and confirm orders
- Check order status
- Update delivery addresses`;

// ============================================================================
// Tool definitions — webhook tools pointing at ModelGuide
// ============================================================================

function webhookTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
) {
  return {
    type: "webhook" as const,
    name,
    description,
    responseTimeoutSecs: 30,
    apiSchema: {
      url: `${WEBHOOK_BASE_URL}/webhooks/elevenlabs/tool`,
      method: "POST" as const,
      requestBodySchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          Object.entries(properties).map(([key, val]) => [
            key,
            val as { type: string; description?: string },
          ]),
        ),
        required,
      },
    },
  };
}

const TOOLS = [
  webhookTool(
    "pizzapalace_add_to_cart",
    "Add an item to the customer's shopping cart",
    {
      item: { type: "string", description: "Item name (e.g. 'large pepperoni pizza')" },
      quantity: { type: "number", description: "Number of items" },
      size: { type: "string", description: "Size: small, medium, or large" },
      toppings: { type: "string", description: "Comma-separated toppings" },
    },
    ["item", "quantity"],
  ),
  webhookTool(
    "pizzapalace_get_cart",
    "View the current cart contents and total",
    {},
    [],
  ),
  webhookTool(
    "pizzapalace_confirm_order",
    "Confirm and place the order. Always ask the customer to confirm first.",
    {
      delivery_address: { type: "string", description: "Full delivery address" },
    },
    ["delivery_address"],
  ),
  webhookTool(
    "pizzapalace_get_order",
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
}

async function updateAgent() {
  console.log(`Updating agent ${AGENT_ID}...`);
  console.log(`  Webhook URL: ${WEBHOOK_BASE_URL}/webhooks/elevenlabs/tool`);
  console.log(`  Tools: ${TOOLS.map((t) => t.name).join(", ")}`);

  const agent = await client.conversationalAi.agents.update(AGENT_ID, {
    name: "Pizza Palace Agent",
    conversationConfig: {
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
          tools: TOOLS,
        },
        firstMessage:
          "Hi, welcome to Pizza Palace! What can I get for you today?",
        language: "en",
        dynamicVariables: {
          dynamic_variables: [
            { name: "mg_api_key", value: MG_API_KEY },
          ],
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
    console.log("Usage:");
    console.log("  bun run examples/elevenlabs-agent/manage-agent.ts get      # Fetch current config");
    console.log("  bun run examples/elevenlabs-agent/manage-agent.ts update   # Push new config");
    console.log("");
    console.log("Env vars:");
    console.log("  ELEVENLABS_API_KEY  — your ElevenLabs API key (required)");
    console.log("  WEBHOOK_URL         — your ngrok base URL (e.g. https://abc123.ngrok.io)");
    console.log("  MG_API_KEY          — ModelGuide API key for the agent (mgk_xxx)");
}
