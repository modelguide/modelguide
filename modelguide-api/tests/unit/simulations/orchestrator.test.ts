import { describe, expect, test } from "bun:test";
import { isConversationEnding } from "@features/simulations/orchestrator";
import confusedBrowser from "../../fixtures/simulations/confused-browser.json";
import impatientReturner from "../../fixtures/simulations/impatient-returner.json";
import politeBuyer from "../../fixtures/simulations/polite-buyer.json";

// ============================================================================
// isConversationEnding
// ============================================================================

describe("isConversationEnding", () => {
  test("detects explicit goodbye phrases", () => {
    expect(isConversationEnding("Goodbye!")).toBe(true);
    expect(isConversationEnding("bye")).toBe(true);
    expect(isConversationEnding("That's all I needed, thank you!")).toBe(true);
    expect(isConversationEnding("Have a good day!")).toBe(true);
    expect(isConversationEnding("Nothing else, thanks")).toBe(true);
    expect(isConversationEnding("That's everything I needed.")).toBe(true);
  });

  test("does not false-positive on words containing ending substrings", () => {
    expect(isConversationEnding("Maybe I should look at another option")).toBe(
      false,
    );
    expect(isConversationEnding("I'll buy it")).toBe(false);
    expect(isConversationEnding("Can you help me?")).toBe(false);
    expect(isConversationEnding("I need a bypass for this issue")).toBe(false);
  });

  test("detects endings in fixture conversations", () => {
    const lastUserMessage = politeBuyer.messages
      .filter((m) => m.role === "user")
      .at(-1);
    expect(lastUserMessage).toBeDefined();
    expect(isConversationEnding(lastUserMessage!.content)).toBe(true);
  });
});

// ============================================================================
// Fixture structure validation
// ============================================================================

describe("simulation fixtures", () => {
  const fixtures = [
    { name: "polite-buyer", data: politeBuyer },
    { name: "impatient-returner", data: impatientReturner },
    { name: "confused-browser", data: confusedBrowser },
  ];

  for (const { name, data } of fixtures) {
    test(`${name} has required fields`, () => {
      expect(data.personaId).toBe(name);
      expect(data.expectedToolCalls).toBeArray();
      expect(data.expectedTurnRange).toBeArrayOfSize(2);
      expect(data.expectedTurnRange[0]).toBeLessThanOrEqual(
        data.expectedTurnRange[1],
      );
      expect(data.expectedTraits).toBeDefined();
      expect(data.messages).toBeArray();
      expect(data.messages.length).toBeGreaterThan(0);
    });

    test(`${name} messages have valid roles`, () => {
      const validRoles = ["user", "assistant", "tool"];
      for (const msg of data.messages) {
        expect(validRoles).toContain(msg.role);
      }
    });
  }
});
