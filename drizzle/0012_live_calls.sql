CREATE TABLE "live_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"transcript" text DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'звоним' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_calls" ADD CONSTRAINT "live_calls_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_calls_client_uq" ON "live_calls" USING btree ("client_id");