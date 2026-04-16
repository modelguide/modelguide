/**
 * Seed step: compile active SOPs for demo agents.
 *
 * Populates compiled_instructions, compiled_at, and compiled_from on agents
 * that have active SOPs assigned. This is required for the eval suite runner
 * which gates on compiled_instructions being non-null.
 *
 * Delegates to compiler.service.compileAgent so seed output stays aligned with
 * the production compiler behavior.
 */

import { compileAgent } from "@features/compiler/compiler.service";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import { agentSops, agents, sops } from "../schema";

type SeedDb = PostgresJsDatabase<typeof schema>;

export async function seedCompileAgents(db: SeedDb): Promise<void> {
  console.log("\n--- Compiling agents from assigned SOPs ---");

  const assignments = await db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      orgId: agents.organizationId,
      sopId: sops.id,
      sopName: sops.name,
      sopStatus: sops.status,
    })
    .from(agentSops)
    .innerJoin(agents, eq(agentSops.agentId, agents.id))
    .innerJoin(sops, eq(agentSops.sopId, sops.id));

  if (assignments.length === 0) {
    console.log("  No agent→SOP assignments found, skipping compilation");
    return;
  }

  const assignmentsByAgent = new Map<
    string,
    {
      agentName: string;
      orgId: string;
      sopIds: string[];
      sopNames: string[];
    }
  >();

  for (const row of assignments) {
    if (row.sopStatus !== "active") continue;

    const existing = assignmentsByAgent.get(row.agentId);
    if (existing) {
      existing.sopIds.push(row.sopId);
      existing.sopNames.push(row.sopName);
      continue;
    }

    assignmentsByAgent.set(row.agentId, {
      agentName: row.agentName,
      orgId: row.orgId,
      sopIds: [row.sopId],
      sopNames: [row.sopName],
    });
  }

  if (assignmentsByAgent.size === 0) {
    console.log(
      "  No active agent→SOP assignments found, skipping compilation",
    );
    return;
  }

  for (const [agentId, data] of assignmentsByAgent) {
    try {
      const result = await compileAgent({
        orgId: data.orgId,
        agentId,
        sopIds: data.sopIds,
      });

      console.log(
        `  Compiled ${data.agentName} from SOPs "${data.sopNames.join('", "')}" ` +
          `(${result.ir.systemPrompt.length} chars, ${result.ir.tools.length} tools)`,
      );
    } catch (err) {
      console.warn(
        `  Failed to compile ${data.agentName}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log("  Agent compilation seeded.");
}
