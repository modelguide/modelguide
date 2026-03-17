import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Env } from "@/env";
import { env } from "@/env";
import {
  ConsoleSender,
  ResendSender,
  getSender,
  resetSenderCache,
} from "@lib/magic-link-sender";

// Mutable ref used to override env values in tests
const mutableEnv = env as { -readonly [K in keyof Env]: Env[K] };

function captureStdout(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  return {
    output,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

describe("ConsoleSender", () => {
  test("writes magic link details to stdout", async () => {
    const { output, restore } = captureStdout();

    const sender = new ConsoleSender();
    await sender.send("user@example.com", "https://example.com/auth?token=abc");

    const all = output.join("");
    expect(all).toContain("user@example.com");
    expect(all).toContain("https://example.com/auth?token=abc");
    expect(all).toContain("MAGIC LINK LOGIN");

    restore();
  });

  test("includes userName when provided", async () => {
    const { output, restore } = captureStdout();

    const sender = new ConsoleSender();
    await sender.send(
      "user@example.com",
      "https://example.com/auth?token=abc",
      "Alice",
    );

    const all = output.join("");
    expect(all).toContain("Alice");

    restore();
  });

  test("omits userName line when not provided", async () => {
    const { output, restore } = captureStdout();

    const sender = new ConsoleSender();
    await sender.send("user@example.com", "https://example.com/auth?token=abc");

    const all = output.join("");
    expect(all).not.toContain("User:");

    restore();
  });
});

describe("ResendSender", () => {
  function createMockSender(mockSend: ReturnType<typeof mock>): ResendSender {
    const sender = new ResendSender("re_test_key", "noreply@example.com");
    // biome-ignore lint/suspicious/noExplicitAny: replacing internal client for test
    (sender as any).resend = { emails: { send: mockSend } };
    return sender;
  }

  test("calls resend API with correct parameters", async () => {
    const mockSend = mock(() =>
      Promise.resolve({ data: { id: "email_123" }, error: null }),
    );
    const sender = createMockSender(mockSend);

    await sender.send(
      "user@example.com",
      "https://example.com/auth?token=abc",
      "Alice",
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = (mockSend.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.from).toBe("noreply@example.com");
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toBe("Your ModelGuide login link");
    expect(call.html).toContain("https://example.com/auth?token=abc");
    expect(call.html).toContain("Hi Alice,");
  });

  test("uses generic greeting when userName not provided", async () => {
    const mockSend = mock(() =>
      Promise.resolve({ data: { id: "email_123" }, error: null }),
    );
    const sender = createMockSender(mockSend);

    await sender.send("user@example.com", "https://example.com/auth?token=abc");

    const call = (mockSend.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.html).toContain("Hi,");
    expect(call.html).not.toContain("Hi Alice,");
  });

  test("escapes HTML characters in userName", async () => {
    const mockSend = mock(() =>
      Promise.resolve({ data: { id: "email_123" }, error: null }),
    );
    const sender = createMockSender(mockSend);

    await sender.send(
      "user@example.com",
      "https://example.com/auth?token=abc",
      '<script>alert("xss")</script>',
    );

    const call = (mockSend.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.html).not.toContain("<script>");
    expect(call.html).toContain("&lt;script&gt;");
  });

  test("throws on resend API error", async () => {
    const mockSend = mock(() =>
      Promise.resolve({
        data: null,
        error: { message: "Invalid API key", name: "validation_error" },
      }),
    );
    const sender = createMockSender(mockSend);

    await expect(
      sender.send("user@example.com", "https://example.com/auth?token=abc"),
    ).rejects.toThrow("Failed to send magic link email: Invalid API key");
  });
});

describe("getSender", () => {
  let originalStrategy: string;
  let originalApiKey: string | undefined;
  let originalFromEmail: string | undefined;

  beforeEach(() => {
    originalStrategy = env.MAGIC_LINK_STRATEGY;
    originalApiKey = env.RESEND_API_KEY;
    originalFromEmail = env.RESEND_FROM_EMAIL;
    resetSenderCache();
  });

  afterEach(() => {
    mutableEnv.MAGIC_LINK_STRATEGY =
      originalStrategy as Env["MAGIC_LINK_STRATEGY"];
    mutableEnv.RESEND_API_KEY = originalApiKey;
    mutableEnv.RESEND_FROM_EMAIL = originalFromEmail;
    resetSenderCache();
  });

  test("returns ConsoleSender when strategy is console", () => {
    mutableEnv.MAGIC_LINK_STRATEGY = "console";
    const sender = getSender();
    expect(sender).toBeInstanceOf(ConsoleSender);
  });

  test("returns ResendSender when strategy is resend", () => {
    mutableEnv.MAGIC_LINK_STRATEGY = "resend";
    mutableEnv.RESEND_API_KEY = "re_test_key";
    mutableEnv.RESEND_FROM_EMAIL = "noreply@example.com";
    const sender = getSender();
    expect(sender).toBeInstanceOf(ResendSender);
  });

  test("caches sender across calls", () => {
    mutableEnv.MAGIC_LINK_STRATEGY = "console";
    const first = getSender();
    const second = getSender();
    expect(first).toBe(second);
  });
});
