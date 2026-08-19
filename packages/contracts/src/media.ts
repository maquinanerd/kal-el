import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const mediaSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(127),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  altText: z.string().max(500).nullable(),
  caption: z.string().max(2000).nullable(),
  credit: z.string().max(500).nullable(),
  focalX: z.number().min(0).max(1).nullable(),
  focalY: z.number().min(0).max(1).nullable(),
  storageKey: z.string().min(1),
  provider: z.string().min(1),
  createdBy: uuidSchema.nullable(),
  externalKey: z.string().min(1).max(200).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const updateMediaBodySchema = z
  .object({
    altText: z.string().max(500).nullable().optional(),
    caption: z.string().max(2000).nullable().optional(),
    credit: z.string().max(500).nullable().optional(),
    focalX: z.number().min(0).max(1).nullable().optional(),
    focalY: z.number().min(0).max(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export type Media = z.infer<typeof mediaSchema>;
export type UpdateMediaBody = z.infer<typeof updateMediaBodySchema>;
