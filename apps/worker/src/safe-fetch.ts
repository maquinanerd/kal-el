import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";

import { isPrivateHost } from "./ssrf.js";

/**
 * Outbound HTTP that cannot be pointed at an internal address by DNS.
 *
 * The delivery-time check closed the window between registration and delivery, but not
 * the one *inside* a single delivery: `assertDeliverableUrl` resolves the name, decides
 * it is public, and then `fetch` resolves it again to open the socket. With a TTL of 0 an
 * attacker answers the first query with a public address and the second with
 * 169.254.169.254, and the request lands on the metadata service having passed every
 * check. That is DNS rebinding, and no amount of checking before the connection closes
 * it, because the checked resolution is not the one the socket uses.
 *
 * The fix is to make them the same resolution. Node's http(s).request accepts a `lookup`
 * function and uses whatever it returns to connect, so validating inside it means the
 * address that was approved is the address the socket dials - there is no second query to
 * poison.
 *
 * Redirects are not followed: a 302 from a validated public URL into an internal one
 * would otherwise bypass everything, and the dispatcher already treats a non-2xx as a
 * delivery failure.
 */

/** Bytes of response body kept. The dispatcher reads the status, not the payload. */
const MAX_BODY_BYTES = 64 * 1024;

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

class BlockedAddressError extends Error {}

/**
 * Refuses if *any* resolved address is private.
 *
 * Not "the first one": with happy-eyeballs and `autoSelectFamily` the runtime may try
 * several, so a record set of [public, private] would otherwise be a working bypass.
 */
function guardedLookup(hostname: string, options: unknown, callback: LookupCallback): void {
  const opts = (typeof options === "object" && options !== null ? options : {}) as { family?: number; hints?: number; all?: boolean };
  dnsLookup(hostname, { family: opts.family, hints: opts.hints, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (list.length === 0) {
      return callback(new BlockedAddressError(`${hostname} resolved to no addresses`), "");
    }
    const blocked = list.find((a) => isPrivateHost(a.address));
    if (blocked) {
      return callback(new BlockedAddressError(`${hostname} resolves to a private or local address (${blocked.address})`), "");
    }
    if (opts.all) return callback(null, list);
    const first = list[0] as LookupAddress;
    callback(null, first.address, first.family);
  });
}

export function isBlockedAddressError(err: unknown): boolean {
  return err instanceof BlockedAddressError;
}

/**
 * A `fetch`-compatible function whose socket can only reach public addresses.
 *
 * Only the subset the dispatcher uses is implemented - method, headers, a string body, an
 * abort signal - and the result is a real `Response`, so callers see no difference.
 */
export const guardedFetch: typeof fetch = (input, init = {}) => {
  if (input instanceof Request) {
    // The dispatcher never builds one, and supporting it would mean re-implementing
    // Request's body/header semantics for no caller.
    return Promise.reject(new Error("guardedFetch takes a URL, not a Request"));
  }
  const url = typeof input === "string" ? new URL(input) : (input as URL);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new Error("only http(s) is supported"));
  }

  const transport = url.protocol === "https:" ? https : http;
  // HeadersInit is three shapes and the dispatcher only uses one, but this is typed as
  // `fetch` - a caller passing a Headers instance would otherwise send no headers at all,
  // silently dropping the signature.
  const headers: Record<string, string> = {};
  const init_headers = init.headers;
  if (init_headers instanceof Headers) {
    init_headers.forEach((v, k) => {
      headers[k] = v;
    });
  } else if (Array.isArray(init_headers)) {
    for (const [k, v] of init_headers) if (k) headers[k] = v ?? "";
  } else if (init_headers) {
    for (const [k, v] of Object.entries(init_headers as Record<string, string>)) headers[k] = v;
  }
  const body = typeof init.body === "string" ? init.body : undefined;
  if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers,
        // The whole point: the address this validates is the address the socket uses.
        // TLS still verifies the certificate against `hostname`, so a rebind cannot be
        // laundered through a valid certificate for another name either.
        lookup: guardedLookup as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            // A subscriber streaming an unbounded body must not be able to exhaust the
            // worker's memory; the status is all that is read.
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", (err) => {
          if (!truncated) reject(err);
        });
        const finish = () => {
          const outHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") outHeaders.set(k, v);
            else if (Array.isArray(v)) outHeaders.set(k, v.join(", "));
          }
          // 204/304 must not carry a body, and constructing a Response with one throws.
          const status = res.statusCode ?? 502;
          const nullBody = status === 204 || status === 205 || status === 304;
          resolve(new Response(nullBody ? null : Buffer.concat(chunks), { status, headers: outHeaders }));
        };
        res.on("end", finish);
        res.on("close", () => {
          if (truncated) finish();
        });
      },
    );

    req.on("error", reject);

    const signal = init.signal;
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error("aborted"));
      } else {
        signal.addEventListener("abort", () => req.destroy(new Error("the operation was aborted")), { once: true });
      }
    }

    if (body !== undefined) req.write(body);
    req.end();
  });
};
