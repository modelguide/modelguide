/**
 * Demo-fixture smoke test for the SOP compiler.
 *
 * Compiles a prompt from a seed directory and verifies the structural shape
 * of the compiled output. Optionally writes the prompt to a file.
 *
 * Required env vars:
 *   SEED_DIR    — path to a directory containing agents.yaml, sops.yaml, guardrails.yaml
 *   AGENT_SLUG  — slug of the agent to compile for
 *   SOP_SLUG    — slug of the SOP to compile
 *
 * Optional env vars:
 *   PROMPT_OUT  — if set, writes the compiled prompt to this path
 *
 * Example:
 *   SEED_DIR=/path/to/seed AGENT_SLUG=my-agent SOP_SLUG=my-sop \
 *     PROMPT_OUT=/tmp/prompt.txt \
 *     bun test tests/integration/compiler/demo-fixture.test.ts
 */

import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { compile } from "@features/compiler/core/compile";
import { loadDemoFixture } from "../../helpers/load-demo-fixture";

const SEED_DIR = process.env.SEED_DIR;
const AGENT_SLUG = process.env.AGENT_SLUG;
const SOP_SLUG = process.env.SOP_SLUG;
const PROMPT_OUT = process.env.PROMPT_OUT;

const hasRequiredEnv = Boolean(SEED_DIR && AGENT_SLUG && SOP_SLUG);

describe.skipIf(!hasRequiredEnv)(
  "Demo fixture — compiled prompt structure",
  () => {
    // Guard so module-level code doesn't run when env vars are absent.
    // describe.skipIf still evaluates the callback body to register tests,
    // so we need this explicit early return.
    if (!hasRequiredEnv) return;

    const input = loadDemoFixture(SEED_DIR!, {
      agentSlug: AGENT_SLUG!,
      sopSlug: SOP_SLUG!,
    });
    const ir = compile(input);
    const prompt = ir.systemPrompt;

    if (PROMPT_OUT) {
      writeFileSync(PROMPT_OUT, prompt, "utf-8");
    }

    // -----------------------------------------------------------------------
    // Structural shape — no domain-specific content asserted
    // -----------------------------------------------------------------------

    it("compiled prompt is non-empty", () => {
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("contains step headers in ## Step N: format", () => {
      expect(prompt).toMatch(/## Step \d+:/);
    });

    it("contains GOAL prefix on at least one step", () => {
      expect(prompt).toContain("GOAL:");
    });

    it("contains EXIT transitions", () => {
      expect(prompt).toContain("EXIT →");
    });

    it("contains a Rules section", () => {
      expect(prompt).toContain("# Rules");
    });

    it("contains a Reminders section", () => {
      expect(prompt).toContain("# Reminders");
    });
  },
);
