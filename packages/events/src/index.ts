import { createHmac, timingSafeEqual } from "node:crypto";

export const HEADER_SIGNATURE = "x-kal-el-signature";
export const HEADER_EVENT = "x-kal-el-event";
export const HEADER_DELIVERY = "x-kal-el-delivery";
export const HEADER_IDEMPOTENCY = "x-kal-el-idempotency";

export function signWebhook(secret: string, body: string | Buffer): string {
  const hmac = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hmac}`;
}

export function verifyWebhookSignature(secret: string, body: string | Buffer, signature: string): boolean {
  const expected = signWebhook(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
