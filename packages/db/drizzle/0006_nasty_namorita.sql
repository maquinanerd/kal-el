SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_site_status_published_idx" ON "articles" USING btree ("site_id","status","published_at" DESC NULLS LAST,"id" DESC NULLS LAST);