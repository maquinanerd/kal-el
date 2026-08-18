import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(h: string): boolean {
  const parts = h.split(".").map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function unmapIpv4(h: string): string | null {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") {
    return true;
  }
  const ip = isIP(h);
  if (ip === 4) return isPrivateIpv4(h);
  if (ip === 6) {
    const mapped = unmapIpv4(h);
    if (mapped) return isPrivateIpv4(mapped);
    if (h === "::1" || h === "::") return true;
    return /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }
  return false;
}

/**
 * Delivery-time SSRF check. Registration-time validation cannot cover DNS rebinding:
 * the name can answer public when the webhook is created and private when it is called.
 */
export async function assertDeliverableUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("webhook url must be http(s)");
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("webhook url resolves to a private or local address");
  }
  if (isIP(parsed.hostname) !== 0) return;
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (addresses.some((a) => isPrivateHost(a.address))) {
    throw new Error("webhook url resolves to a private or local address");
  }
}
