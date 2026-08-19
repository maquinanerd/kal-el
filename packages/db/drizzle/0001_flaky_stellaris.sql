ALTER TABLE "authors" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authors_site_user_unique" ON "authors" USING btree ("site_id","user_id");