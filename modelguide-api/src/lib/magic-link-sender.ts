import { env } from "@/env";
import { Resend } from "resend";

export interface MagicLinkSender {
  send(email: string, link: string, userName?: string): Promise<void>;
}

export class ConsoleSender implements MagicLinkSender {
  async send(email: string, link: string, userName?: string): Promise<void> {
    const rawLabel = userName ? `${userName} <${email}>` : email;
    const label =
      rawLabel.length > 28 ? `${rawLabel.slice(0, 25)}...` : rawLabel;
    const expires = `${env.MAGIC_LINK_EXPIRES_IN_MINUTES} min`;
    console.log(
      `\n\x1b[33m╔══════════════════════════════════════════╗\n║  🔗  MAGIC LINK LOGIN                    ║\n╠══════════════════════════════════════════╣\n║  To:      ${label.padEnd(30)} ║\n║  Expires: ${expires.padEnd(30)} ║\n╠══════════════════════════════════════════╣\x1b[0m\n\x1b[1m  ${link}\x1b[0m\n\x1b[33m╚══════════════════════════════════════════╝\x1b[0m\n`,
    );
  }
}

export class ResendSender implements MagicLinkSender {
  private resend: Resend;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.resend = new Resend(apiKey);
    this.from = from;
  }

  async send(email: string, link: string, userName?: string): Promise<void> {
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: email,
      subject: "Your ModelGuide login link",
      html: buildEmailHtml(link, userName),
    });

    if (error) {
      throw new Error(`Failed to send magic link email: ${error.message}`);
    }

    console.info(`[auth] Email sent via Resend (id: ${data?.id}) to ${email}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(link: string, userName?: string): string {
  const greeting = userName ? `Hi ${escapeHtml(userName)},` : "Hi,";
  const expiresIn = env.MAGIC_LINK_EXPIRES_IN_MINUTES;

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Sign in to ModelGuide</h2>
      <p>${greeting}</p>
      <p>Click the link below to sign in to your account:</p>
      <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: #fff; text-decoration: none; border-radius: 6px;">Sign in</a></p>
      <p style="color: #666; font-size: 14px;">This link expires in ${expiresIn} minutes.</p>
      <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;
}

// Cached for process lifetime — env changes require a restart.
let cachedSender: MagicLinkSender | undefined;

export function getSender(): MagicLinkSender {
  if (cachedSender) return cachedSender;

  if (env.MAGIC_LINK_STRATEGY === "resend") {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY is required when MAGIC_LINK_STRATEGY is 'resend'",
      );
    }
    const from = env.RESEND_FROM_EMAIL;
    if (!from) {
      throw new Error(
        "RESEND_FROM_EMAIL is required when MAGIC_LINK_STRATEGY is 'resend'",
      );
    }
    cachedSender = new ResendSender(apiKey, from);
  } else {
    cachedSender = new ConsoleSender();
  }

  return cachedSender;
}

/** Reset cached sender -- for testing only */
export function resetSenderCache(): void {
  cachedSender = undefined;
}
