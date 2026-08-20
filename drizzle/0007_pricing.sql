CREATE TABLE "pricing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category_pattern" text,
	"min_cost" double precision,
	"max_cost" double precision,
	"markup_pct" double precision NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "suggested_price" double precision;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "rule_id" integer;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "client_price" double precision;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "market_price" double precision;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "price_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "pricing_rules_priority_idx" ON "pricing_rules" USING btree ("priority");--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_rule_id_pricing_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE no action ON UPDATE no action;