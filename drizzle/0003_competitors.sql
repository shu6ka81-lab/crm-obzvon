CREATE TYPE "public"."client_source" AS ENUM('crm_1c', 'competitor');--> statement-breakpoint
DROP INDEX "clients_code_1c_uq";--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "code_1c" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_clients" ADD COLUMN "preset_supplier" text;--> statement-breakpoint
ALTER TABLE "campaign_clients" ADD COLUMN "preset_purchases" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "source" "client_source" DEFAULT 'crm_1c' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_inn_uq" ON "clients" USING btree ("inn") WHERE "clients"."inn" is not null;--> statement-breakpoint
CREATE INDEX "clients_source_idx" ON "clients" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_code_1c_uq" ON "clients" USING btree ("code_1c") WHERE "clients"."code_1c" is not null;