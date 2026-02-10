CREATE TABLE "session_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"url" varchar(2048) NOT NULL,
	"title" varchar(255),
	"connector_slug" varchar(100),
	"resource_type" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_links" ADD CONSTRAINT "session_links_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "session_links_session_url_unique" ON "session_links" USING btree ("session_id","url");
--> statement-breakpoint
CREATE INDEX "session_links_session_idx" ON "session_links" USING btree ("session_id");
