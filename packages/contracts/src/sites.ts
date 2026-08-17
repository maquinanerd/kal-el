import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const siteStatusSchema = z.enum(["active", "inactive"]);

export const siteSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric with dashes"),
  name: z.string().min(1).max(120),
  status: siteStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createSiteBodySchema = z
  .object({
    slug: siteSchema.shape.slug,
    name: siteSchema.shape.name,
  })
  .strict();

export const updateSiteBodySchema = z
  .object({
    name: siteSchema.shape.name.optional(),
    status: siteStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

import { createUserBodySchema } from "./identity";

export const initBootstrapBodySchema = z
  .object({
    site: createSiteBodySchema,
    user: createUserBodySchema,
  })
  .strict();

export type Site = z.infer<typeof siteSchema>;
export type CreateSiteBody = z.infer<typeof createSiteBodySchema>;
export type UpdateSiteBody = z.infer<typeof updateSiteBodySchema>;
export type InitBootstrapBody = z.infer<typeof initBootstrapBodySchema>;
