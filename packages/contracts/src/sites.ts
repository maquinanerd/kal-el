import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const siteStatusSchema = z.enum(["active", "inactive"]);

/** Host label per RFC 1123, plus at least one dot so `localhost` alone is rejected. */
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * The site's canonical host.
 *
 * Accepts what a person actually types — `https://MaquinaNerd.com.br/`, `www.` and all —
 * and normalises to the bare lowercase host, because everything downstream (SERP preview,
 * canonical defaults, editorial URLs) needs to concatenate it, not parse it. Storing the
 * scheme would put `https://https://…` in a preview the first time someone pasted a URL.
 */
export const primaryDomainSchema = z
  .string()
  .trim()
  .max(253)
  .transform((raw) => raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "").replace(/\.$/, "").toLowerCase())
  .refine((host) => host === "" || HOSTNAME.test(host), {
    message: "informe um domínio válido, por exemplo maquinanerd.com.br",
  })
  // an empty field clears the domain rather than storing ""
  .transform((host) => (host === "" ? null : host));

export const siteSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric with dashes"),
  name: z.string().min(1).max(120),
  primaryDomain: z.string().nullable(),
  status: siteStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createSiteBodySchema = z
  .object({
    slug: siteSchema.shape.slug,
    name: siteSchema.shape.name,
    primaryDomain: primaryDomainSchema.optional(),
  })
  .strict();

export const updateSiteBodySchema = z
  .object({
    name: siteSchema.shape.name.optional(),
    primaryDomain: primaryDomainSchema.nullable().optional(),
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
