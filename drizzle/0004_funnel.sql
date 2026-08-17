CREATE TYPE "public"."funnel_stage" AS ENUM('lead', 'contacted', 'audit', 'quote', 'decision', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "stage_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_client_id" integer NOT NULL,
	"from_stage" "funnel_stage",
	"to_stage" "funnel_stage" NOT NULL,
	"user_id" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_clients" ADD COLUMN "stage" "funnel_stage" DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_clients" ADD COLUMN "stage_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_clients" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_campaign_client_id_campaign_clients_id_fk" FOREIGN KEY ("campaign_client_id") REFERENCES "public"."campaign_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_changes_link_idx" ON "stage_changes" USING btree ("campaign_client_id","created_at");