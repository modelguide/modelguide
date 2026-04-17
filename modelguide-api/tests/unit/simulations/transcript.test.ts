import { describe, expect, test } from "bun:test";
import {
  toAgentCoreHistory,
  toPersonaLlmHistory,
  toTranscriptTurns,
} from "@features/simulations/transcript";

describe("simulation transcript projections", () => {
  const storedHistory = [
    { role: "system" as const, content: "Keep the customer calm." },
    { role: "user" as const, content: "I need help with my order." },
    { role: "assistant" as const, content: "What's your order number?" },
    { role: "tool" as const, content: "lookup result" },
  ];

  test("makes customer and agent speakers explicit", () => {
    expect(toTranscriptTurns(storedHistory)).toEqual([
      { speaker: "system", content: "Keep the customer calm." },
      { speaker: "customer", content: "I need help with my order." },
      { speaker: "agent", content: "What's your order number?" },
      { speaker: "tool", content: "lookup result" },
    ]);
  });

  test("projects stored history into the persona model POV", () => {
    expect(toPersonaLlmHistory(storedHistory)).toEqual([
      { role: "system", content: "Keep the customer calm." },
      { role: "assistant", content: "I need help with my order." },
      { role: "user", content: "What's your order number?" },
    ]);
  });

  test("projects stored history into the agent model POV", () => {
    expect(toAgentCoreHistory(storedHistory)).toEqual([
      { role: "system", content: "Keep the customer calm." },
      { role: "user", content: "I need help with my order." },
      { role: "assistant", content: "What's your order number?" },
    ]);
  });
});
