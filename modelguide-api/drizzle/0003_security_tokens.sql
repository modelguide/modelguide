-- Security tokens table for refresh token sessions
CREATE TABLE IF NOT EXISTS "security_tokens" (
  "family_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL DEFAULT 0,
  "is_revoked" boolean NOT NULL DEFAULT false,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "security_tokens_user_idx" ON "security_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "security_tokens_expires_idx" ON "security_tokens" ("expires_at");
