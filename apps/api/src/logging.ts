import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "./config.js";

/**
 * Fields that must never reach a log line, at any depth.
 *
 * Pino's redact paths are matched against the serialized object, so the request/reply
 * serializers below are deliberately narrow (they emit an allow-list of fields) and this
 * list is the second line of defence for anything that slips through a manual
 * `log.info({ ... })` call.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-bootstrap-token']",
  "req.headers['x-kal-el-csrf']",
  "req.headers['idempotency-key']",
  "headers.authorization",
  "headers.cookie",
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "tokenHash",
  "token_hash",
  "csrfToken",
  "csrfTokenHash",
  "secret",
  "sessionToken",
  "bootstrapToken",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.tokenHash",
  "*.secret",
];

/**
 * Human-readable line for development.
 *
 * Pino's own pretty printer is a separate package and a separate process; a deployment
 * that does not have it installed falls back to raw JSON with no warning. This keeps the
 * dev experience dependency-free, and production never goes through it.
 */
function devLine(chunk: string): string {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(chunk) as Record<string, unknown>;
  } catch {
    return chunk;
  }
  const levels: Record<number, string> = { 10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" };
  const level = levels[Number(record.level)] ?? String(record.level ?? "");
  const time = typeof record.time === "number" ? new Date(record.time).toISOString().slice(11, 23) : "";
  const reqId = record.reqId ?? record.requestId;
  const parts: string[] = [];
  if (record.method && record.path) parts.push(`${String(record.method)} ${String(record.path)}`);
  if (record.statusCode !== undefined) parts.push(`-> ${String(record.statusCode)}`);
  if (record.durationMs !== undefined) parts.push(`${String(record.durationMs)}ms`);
  if (record.msg) parts.push(String(record.msg));
  const extras = Object.entries(record).filter(
    ([k]) => !["level", "time", "pid", "hostname", "msg", "reqId", "method", "path", "statusCode", "durationMs", "req", "res"].includes(k),
  );
  const tail = extras.length > 0 ? ` ${JSON.stringify(Object.fromEntries(extras))}` : "";
  return `${time} ${level.padEnd(5)} ${reqId ? `[${String(reqId)}] ` : ""}${parts.join(" ")}${tail}\n`;
}

const devStream = {
  write(chunk: string): void {
    process.stdout.write(devLine(chunk));
  },
};

/**
 * Logger configuration for `Fastify({ logger })`.
 *
 * `logger: false` was the shipped default, so every real deployment ran with a no-op
 * logger: `request.log.error` wrote nowhere and the `requestId` returned in each error
 * body correlated with nothing. Production emits one JSON object per line (parsed as-is by
 * every log shipper); development emits a readable line through the stream above.
 */
export function loggerOptions(config: AppConfig): Record<string, unknown> {
  const production = config.NODE_ENV === "production";
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    // The default serializers dump every header, which is exactly where the session
    // cookie and the bearer token live. Emit an explicit allow-list instead.
    serializers: {
      req(req: FastifyRequest) {
        return {
          method: req.method,
          path: req.url,
          remoteAddress: req.ip,
          userAgent: req.headers["user-agent"],
        };
      },
      res(reply: FastifyReply) {
        return { statusCode: reply.statusCode };
      },
    },
    ...(production ? {} : { stream: devStream }),
  };
}

type ActorLike = { kind?: string; userId?: string; tokenId?: string; siteId?: string };

/**
 * Per-request completion log.
 *
 * Fastify's built-in request/response logging emits two lines and carries none of the
 * editorial context, so a 403 in production could not be attributed to a site or an
 * integration. This emits one line per request with the fields an operator actually
 * filters on.
 */
export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook("onResponse", async (req, reply) => {
    const actor = (req as { actor?: ActorLike }).actor;
    req.log.info(
      {
        method: req.method,
        path: req.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        actorType: actor?.kind ?? null,
        actorId: actor?.kind === "service" ? (actor.tokenId ?? null) : (actor?.userId ?? null),
        siteId: actor?.siteId ?? null,
      },
      "request completed",
    );
  });
}
