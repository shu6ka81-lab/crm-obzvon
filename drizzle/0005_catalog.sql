CREATE TABLE "catalog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"article" varchar(64),
	"name" text NOT NULL,
	"category" text,
	"qty_sold" double precision DEFAULT 0 NOT NULL,
	"sale_sum" bigint DEFAULT 0 NOT NULL,
	"buy_sum" bigint DEFAULT 0 NOT NULL,
	"months_seen" integer DEFAULT 0 NOT NULL,
	"unit_price" double precision DEFAULT 0 NOT NULL,
	"unit_cost" double precision DEFAULT 0 NOT NULL,
	"markup_pct" double precision DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_code_uq" ON "catalog_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "catalog_items_name_idx" ON "catalog_items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "catalog_items_sale_idx" ON "catalog_items" USING btree ("sale_sum");