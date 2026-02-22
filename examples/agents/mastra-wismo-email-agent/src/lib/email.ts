import { Resend } from "resend";
import { config } from "../config.js";
import { logger } from "./logger.js";

const resend = new Resend(config.RESEND_API_KEY);

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
}): Promise<{ id: string }> {
  const headers: Record<string, string> = {};

  if (params.inReplyTo) {
    headers["In-Reply-To"] = params.inReplyTo;
    headers["References"] = params.inReplyTo;
  }

  const result = await resend.emails.send({
    from: config.INBOX_EMAIL,
    to: params.to,
    subject: params.subject,
    text: params.text,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  logger.debug({ resendId: result.data!.id }, "Email sent");

  return { id: result.data!.id };
}

/**
 * Strips quoted reply content from email text.
 * Stops at "On ... wrote:" pattern or lines starting with ">".
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    if (/^On .+ wrote:/.test(line)) break;
    if (line.startsWith(">")) break;
    result.push(line);
  }

  return result.join("\n").trimEnd();
}

/**
 * Extracts the email address from "Display Name <email>" or plain email format.
 */
export function extractEmailAddress(input: string): {
  email: string;
  name: string | null;
} {
  const match = input.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { email: match[2].trim(), name: match[1].trim() };
  }
  return { email: input.trim(), name: null };
}
