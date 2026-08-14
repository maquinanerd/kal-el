import { createHash, randomBytes } from "node:crypto";

export function generateOpaqueToken(prefix: string): string {
  return `${prefix}.${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionTokenPrefix(): string {
  return "ke_s";
}

export function serviceTokenPrefix(): string {
  return "ke_st";
}

export function requestId(): string {
  return randomBytes(16).toString("hex");
}
