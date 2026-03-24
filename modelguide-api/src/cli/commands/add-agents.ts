/**
 * mg add-agents — Batch create agents in an org.
 * Delegates to agents.service.createAgent (auto-generates API key)
 * and agents.service.assignConnectorToAgent for tool links.
 */

import {
  assignConnectorToAgent,
  createAgent,
} from "@features/agents/agents.service";
import {
  listConnectorTools,
  listConnectors,
} from "@features/connectors/connectors.service";
import { listUsers } from "@features/users/users.service";
import type { Command } from "commander";
import { getErrorMessage, isDuplicateError } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log, table } from "../lib/logger";
import { parseKvArgs } from "../lib/parse-kv";
import { resolveOrgId } from "../lib/resolve-org";
import { loadYaml } from "../lib/yaml-loader";
import {
  type AgentItemInput,
  agentItemSchema,
  agentsFileSchema,
} from "../schemas/agents.schema";

/**
 * Build a connector slug→id map from existing connectors.
 */
async function resolveConnectors(
  orgId: string,
  registry?: IdRegistry,
): Promise<Map<string, string>> {
  if (registry) {
    return registry.getAll("connector");
  }
  const { data } = await listConnectors(orgId, { page: 1, pageSize: 100 });
  const map = new Map<string, string>();
  for (const c of data) {
    map.set(c.slug, c.id);
  }
  return map;
}

export async function handleAddAgents(
  orgId: string,
  items: AgentItemInput[],
  options?: { registry?: IdRegistry; createdBy?: string },
): Promise<{
  created: number;
  existing: number;
  apiKeys: { name: string; key: string }[];
}> {
  const connectorMap = await resolveConnectors(orgId, options?.registry);
  let created = 0;
  let existing = 0;
  const apiKeys: { name: string; key: string }[] = [];

  // We need a user ID for createdBy. Use provided or look up first admin.
  const createdBy =
    options?.createdBy ?? (await getFirstUserId(orgId, options?.registry));

  for (const item of items) {
    try {
      const result = await createAgent(
        orgId,
        {
          name: item.name,
          slug: item.slug,
          description: item.description,
          modality: item.modality,
          agentPlatform: item.platform,
        },
        createdBy,
      );

      const agentId = result.agent.id;

      if (options?.registry) {
        options.registry.set("agent", result.agent.slug, agentId);
      }

      apiKeys.push({ name: item.name, key: result.apiKey });

      // Assign connector tools
      for (const toolLink of item.tools) {
        const connectorId = connectorMap.get(toolLink.connectorSlug);
        if (!connectorId) {
          log.warn(
            `Connector "${toolLink.connectorSlug}" not found, skipping tool assignment for agent ${item.name}`,
          );
          continue;
        }

        let tools: { slug: string; isEnabled?: boolean }[];
        if (toolLink.toolSlugs && toolLink.toolSlugs.length > 0) {
          tools = toolLink.toolSlugs.map((slug) => ({
            slug,
            isEnabled: true,
          }));
        } else {
          // Assign all tools from the connector
          const allTools = await listConnectorTools(orgId, connectorId);
          tools = allTools.map((t) => ({ slug: t.slug, isEnabled: true }));
        }

        if (tools.length > 0) {
          await assignConnectorToAgent(orgId, agentId, {
            connectorId,
            tools,
          });
        }
      }

      log.success(
        `Created agent: ${item.name} (${item.tools.length} connector links)`,
      );
      created++;
    } catch (err) {
      if (isDuplicateError(err)) {
        log.info(`Found existing agent: ${item.name}`);
        existing++;
      } else {
        throw err;
      }
    }
  }

  // Print API keys table
  if (apiKeys.length > 0) {
    const tbl = table(
      ["Agent", "API Key"],
      apiKeys.map((k) => [k.name, k.key]),
    );
    log.info(`API Keys (shown once):\n${tbl}`);
  }

  return { created, existing, apiKeys };
}

async function getFirstUserId(
  orgId: string,
  registry?: IdRegistry,
): Promise<string> {
  if (registry) {
    const users = registry.getAll("user");
    const first = users.values().next();
    if (!first.done) return first.value;
  }
  // Fallback: look up first user from the DB
  const { data } = await listUsers(orgId, { page: 1, pageSize: 1 });
  if (data.length > 0) return data[0].id;
  throw new Error("No users found in org — create users before agents");
}

export function registerAddAgentsCommand(program: Command): void {
  program
    .command("add-agents")
    .description("Batch create agents in an organization")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--from <file>", "Load from YAML file")
    .argument("[entries...]", "Key=value agent entries")
    .action(async (entries: string[], opts) => {
      const orgId = await resolveOrgId(opts.org);

      let items: AgentItemInput[];

      if (opts.from) {
        const data = loadYaml(opts.from, agentsFileSchema);
        items = data.agents;
      } else if (entries.length > 0) {
        const kvs = parseKvArgs(entries);
        items = kvs.map((kv) => agentItemSchema.parse(kv));
      } else {
        log.error("Provide agent entries as args or --from <file>");
        process.exit(1);
      }

      try {
        const result = await handleAddAgents(orgId, items);
        log.success(
          `Agents: ${result.created} created, ${result.existing} existing`,
        );
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
