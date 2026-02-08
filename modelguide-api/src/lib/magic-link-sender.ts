import { env } from "@/env";
import { Resend } from "resend";

export interface MagicLinkSender {
  send(email: string, link: string, userName?: string): Promise<void>;
}

export class ConsoleSender implements MagicLinkSender {
  async send(email: string, link: string, userName?: string): Promise<void> {
    console.log("\n========================================");
    console.log("MAGIC LINK LOGIN");
    console.log("========================================");
    console.log(`Email: ${email}`);
    if (userName) {
      console.log(`User: ${userName}`);
    }
    console.log(`Link: ${link}`);
    console.log(`Expires in: ${env.MAGIC_LINK_EXPIRES_IN_MINUTES} minutes`);
    console.log("========================================\n");
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
    const greeting = userName ? `Hi ${userName},` : "Hi,";

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: email,
      subject: "Your ModelGuide login link",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Sign in to ModelGuide</h2>
          <p>${greeting}</p>
          <p>Click the link below to sign in to your account:</p>
          <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: #fff; text-decoration: none; border-radius: 6px;">Sign in</a></p>
          <p style="color: #666; font-size: 14px;">This link expires in ${env.MAGIC_LINK_EXPIRES_IN_MINUTES} minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      throw new Error(`Failed to send magic link email: ${error.message}`);
    }
  }
}

let cachedSender: MagicLinkSender | undefined;

export function getSender(): MagicLinkSender {
  if (cachedSender) return cachedSender;

  if (env.MAGIC_LINK_STRATEGY === "resend") {
    const from =
      env.RESEND_FROM_EMAIL ?? `noreply@${new URL(env.APP_URL).hostname}`;
    cachedSender = new ResendSender(env.RESEND_API_KEY!, from);
  } else {
    cachedSender = new ConsoleSender();
  }

  return cachedSender;
}

/** Reset cached sender — for testing only */
export function resetSenderCache(): void {
  cachedSender = undefined;
}
