CREATE TYPE "public"."call_request_state" AS ENUM('waiting', 'calling', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "call_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"campaign_id" integer,
	"campaign_client_id" integer,
	"requested_by" integer,
	"state" "call_request_state" DEFAULT 'waiting' NOT NULL,
	"phone" varchar(64) NOT NULL,
	"note" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_campaign_client_id_campaign_clients_id_fk" FOREIGN KEY ("campaign_client_id") REFERENCES "public"."campaign_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_requests_state_idx" ON "call_requests" USING btree ("state","created_at");