CREATE TYPE "public"."activity_segment" AS ENUM('active', 'd61', 'd91', 'd121', 'inactive', 'new', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."campaign_client_state" AS ENUM('pending', 'in_progress', 'done', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('legal', 'individual', 'intercity', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."qualified" AS ENUM('yes', 'no', 'thinking');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."touch_channel" AS ENUM('call', 'email', 'meeting', 'messenger');--> statement-breakpoint
CREATE TYPE "public"."touch_outcome" AS ENUM('reached', 'no_answer', 'busy', 'wrong_number', 'callback', 'refused');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('manager', 'head');--> statement-breakpoint
CREATE TABLE "campaign_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"state" "campaign_client_state" DEFAULT 'pending' NOT NULL,
	"preset_budget" bigint,
	"preset_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_file" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_1c" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"inn" varchar(12),
	"segment" "activity_segment" DEFAULT 'unknown' NOT NULL,
	"status_1c" text,
	"manager_1c" text,
	"total_sum" bigint DEFAULT 0 NOT NULL,
	"shipments_count" integer DEFAULT 0 NOT NULL,
	"avg_check" bigint DEFAULT 0 NOT NULL,
	"last_order_date" date,
	"comment_1c" text,
	"comment_1c_date" date,
	"imported_at" timestamp with time zone,
	"import_batch_id" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"report_date" date,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_created" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"contact_position" text,
	"people_served" integer,
	"monthly_budget" bigint,
	"other_suppliers" text,
	"client_type" "client_type" DEFAULT 'unknown' NOT NULL,
	"is_qualified" "qualified",
	"reject_reason" text,
	"filled_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"assigned_to" integer,
	"created_from_touch_id" integer,
	"due_date" date NOT NULL,
	"title" text NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "touches" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"campaign_id" integer,
	"user_id" integer,
	"happened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" "touch_channel" DEFAULT 'call' NOT NULL,
	"outcome" "touch_outcome" NOT NULL,
	"duration_sec" integer,
	"got_quote_request" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'manager' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_clients" ADD CONSTRAINT "campaign_clients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_clients" ADD CONSTRAINT "campaign_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_filled_by_users_id_fk" FOREIGN KEY ("filled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_clients_uq" ON "campaign_clients" USING btree ("campaign_id","client_id");--> statement-breakpoint
CREATE INDEX "campaign_clients_queue_idx" ON "campaign_clients" USING btree ("campaign_id","state","position");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_code_1c_uq" ON "clients" USING btree ("code_1c");--> statement-breakpoint
CREATE INDEX "clients_segment_idx" ON "clients" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "clients_total_sum_idx" ON "clients" USING btree ("total_sum");--> statement-breakpoint
CREATE INDEX "clients_name_idx" ON "clients" USING btree ("name");--> statement-breakpoint
CREATE INDEX "qualifications_client_idx" ON "qualifications" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "tasks_client_idx" ON "tasks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "touches_client_idx" ON "touches" USING btree ("client_id","happened_at");--> statement-breakpoint
CREATE INDEX "touches_campaign_idx" ON "touches" USING btree ("campaign_id","happened_at");