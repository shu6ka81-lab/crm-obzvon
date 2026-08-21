ALTER TYPE "public"."touch_channel" ADD VALUE 'bot' BEFORE 'email';--> statement-breakpoint
ALTER TABLE "touches" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "touches" ADD COLUMN "recording" text;--> statement-breakpoint
ALTER TABLE "touches" ADD COLUMN "bot_category" varchar(32);--> statement-breakpoint
ALTER TABLE "touches" ADD COLUMN "cost_rub" double precision;