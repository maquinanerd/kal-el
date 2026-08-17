import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const webhookEventSchema = z.enum(["article.published", "article.scheduled", "article.updated"]);

export const webhookSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  url: z.string().url().max(2048),
  events: z.array(webhookEventSchema).min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createWebhookBodySchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine((u) => /^https?:\/\//i.test(u), "only http(s) URLs are allowed"),
    events: z.array(webhookEventSchema).min(1),
    // optional subscriber-supplied signing secret; generated if omitted
    secret: z.string().min(16).max(128).optional(),
  })
  .strict();

export const webhookDeliverySchema = z.object({
  id: uuidSchema,
  webhookId: uuidSchema,
  outboxEventId: uuidSchema,
  status: z.enum(["pending", "success", "failed"]),
  attempt: z.number().int().nonnegative(),
  responseStatus: z.number().int().nullable(),
  error: z.string().max(1000).nullable(),
  createdAt: timestampSchema,
  deliveredAt: timestampSchema.nullable(),
});

export type Webhook = z.infer<typeof webhookSchema>;
export type CreateWebhookBody = z.infer<typeof createWebhookBodySchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
