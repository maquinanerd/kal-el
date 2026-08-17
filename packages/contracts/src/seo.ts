import { z } from "zod";

export const robotsIndexSchema = z.enum(["index", "noindex"]);
export const robotsFollowSchema = z.enum(["follow", "nofollow"]);

export const seoMetadataSchema = z.object({
  seoTitle: z.string().max(160).nullable(),
  metaDescription: z.string().max(320).nullable(),
  canonicalUrl: z.string().url().max(2048).nullable(),
  robotsIndex: robotsIndexSchema.default("index"),
  robotsFollow: robotsFollowSchema.default("follow"),
  socialTitle: z.string().max(160).nullable(),
  socialDescription: z.string().max(320).nullable(),
});

export const redirectKindSchema = z.enum(["301", "302"]);

export const redirectSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  sourcePath: z.string().min(1).max(2048).startsWith("/"),
  targetPath: z.string().min(1).max(2048).startsWith("/"),
  kind: redirectKindSchema,
});

export const createRedirectBodySchema = z
  .object({
    sourcePath: redirectSchema.shape.sourcePath,
    targetPath: redirectSchema.shape.targetPath,
    kind: redirectKindSchema.default("301"),
  })
  .strict();

export type SeoMetadata = z.infer<typeof seoMetadataSchema>;
export type Redirect = z.infer<typeof redirectSchema>;
export type CreateRedirectBody = z.infer<typeof createRedirectBodySchema>;
