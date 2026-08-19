/**
 * Worker logging.
 *
 * The worker wrote every line with `console.log`, so a scheduled publish that failed at
 * 03:00 produced a bare string with no level, no timestamp and no article id that a log
 * shipper could index. This emits one JSON object per line in production - the same shape
 * the API emits - and a readable line otherwise.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { silent: 100, error: 50, warn: 40, info: 30, debug: 20 };
const PINO_LEVEL: Record<Exclude<LogLevel, "silent">, number> = { error: 50, warn: 40, info: 30, debug: 20 };

export type Logger = {
  debug: (fields: Record<string, unknown>, msg: string) => void;
  info: (fields: Record<string, unknown>, msg: string) => void;
  warn: (fields: Record<string, unknown>, msg: string) => void;
  error: (fields: Record<string, unknown>, msg: string) => void;
};

const SECRET_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "tokenhash",
  "secret",
  "authorization",
  "cookie",
  "csrftoken",
  "csrftokenhash",
  "bootstraptoken",
  "sessiontoken",
]);

/** Drop anything whose key names a credential, at any depth. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase().replace(/_/g, "")) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export function createLogger(opts: { level: LogLevel; json: boolean; name?: string }): Logger {
  const threshold = ORDER[opts.level];
  const emit = (level: Exclude<LogLevel, "silent">, fields: Record<string, unknown>, msg: string) => {
    if (ORDER[level] < threshold) return;
    const safe = redact(fields) as Record<string, unknown>;
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ level: PINO_LEVEL[level], time: Date.now(), name: opts.name ?? "worker", ...safe, msg })}\n`,
      );
      return;
    }
    const time = new Date().toISOString().slice(11, 23);
    const extras = Object.keys(safe).length > 0 ? ` ${JSON.stringify(safe)}` : "";
    process.stdout.write(`${time} ${level.toUpperCase().padEnd(5)} [${opts.name ?? "worker"}] ${msg}${extras}\n`);
  };
  return {
    debug: (f, m) => emit("debug", f, m),
    info: (f, m) => emit("info", f, m),
    warn: (f, m) => emit("warn", f, m),
    error: (f, m) => emit("error", f, m),
  };
}

/** A logger that discards everything. Used by tests and by LOG_LEVEL=silent. */
export const nullLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
