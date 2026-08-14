import { createHmac, timingSafeEqual } from "node:crypto";

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

export function normalizeSignature(signature: string): string {
  return signature.trim().toLowerCase();
}
