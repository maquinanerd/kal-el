import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const webhookEventSchema = z.enum(["article.published", "article.scheduled", "article.updated"]);

export const webhookSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  url: z.string().url().max(2048),
  events: z.array(webhookEventSchema).min(1),
  /** Operator-facing name, so an admin list is not a column of opaque URLs. */
  description: z.string().max(200).nullable().default(null),
  /** A paused subscriber receives nothing; the signing secret survives the pause. */
  enabled: z.boolean().default(true),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const webhookUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "only http(s) URLs are allowed");

export const createWebhookBodySchema = z
  .object({
    url: webhookUrlSchema,
    events: z.array(webhookEventSchema).min(1),
    description: z.string().max(200).optional(),
    // optional subscriber-supplied signing secret; generated if omitted
    secret: z.string().min(16).max(128).optional(),
  })
  .strict();

/**
 * `secret` is deliberately not updatable.
 *
 * Rotating it silently breaks the subscriber's verification with no way for them to know
 * which key a given delivery was signed with. Replacing the webhook is the honest path:
 * the new secret is shown once, as on creation.
 */
export const updateWebhookBodySchema = z
  .object({
    url: webhookUrlSchema.optional(),
    events: z.array(webhookEventSchema).min(1).optional(),
    description: z.string().max(200).nullable().optional(),
    enabled: z.boolean().optional(),
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
export type UpdateWebhookBody = z.infer<typeof updateWebhookBodySchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
