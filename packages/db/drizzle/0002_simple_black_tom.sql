ALTER TABLE "media" ADD COLUMN "external_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "media_site_external_key_unique" ON "media" USING btree ("site_id","external_key");