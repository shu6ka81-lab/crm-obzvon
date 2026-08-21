CREATE TYPE "public"."campaign_kind" AS ENUM('acquisition', 'return');--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "kind" "campaign_kind" DEFAULT 'acquisition' NOT NULL;