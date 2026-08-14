import { z } from "zod";

export const uuidSchema = z.string().uuid({ message: "must be a valid UUID" });

export const timestampSchema = z.string().datetime({ offset: true });

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "idempotency key must be a safe string");

export const limitSchema = z.coerce.number().int().min(1).max(100).default(25);

export const cursorSchema = z.string().max(256).optional();

export const cursorPageSchema = z.object({
  cursor: cursorSchema,
  limit: limitSchema,
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type CursorPage = z.infer<typeof cursorPageSchema>;

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  });
}

export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data,
  });
