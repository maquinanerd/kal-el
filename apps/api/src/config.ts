import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Allow webhooks that point at private/loopback addresses. Every other production
   * guard keys off NODE_ENV, which defaults to "development" - so a deployment that
   * forgets to set it silently disables the SSRF check. This one is opt-in instead.
   */
  ALLOW_PRIVATE_WEBHOOKS: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => v === true || v === "true" || v === "1"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).default("postgresql://kalel:kalel@localhost:5432/kalel"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:3001"),
  SESSION_SECRET: z.string().min(1).default("development-only-secret"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  CORS_ORIGINS: z.string().default(""),
  ENABLE_DOCS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  BOOTSTRAP_TOKEN: z.string().optional(),
  MEDIA_STORAGE_PROVIDER: z.enum(["local"]).default("local"),
  MEDIA_LOCAL_PATH: z.string().min(1).default("./uploads"),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  /**
   * Log verbosity. `silent` is what the test suite uses; every other value produces
   * output. There is deliberately no way to express "no logger at all" other than this,
   * so a production deployment cannot end up silent by omission.
   */
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  /**
   * Reverse-proxy trust policy.
   *
   * `req.ip` is what the rate limiter keys on. Behind a proxy with no trust configured,
   * every request carries the proxy's address and the whole platform shares one bucket -
   * ten failed logins from one host lock out everyone. `trustProxy: true` is worse: it
   * takes the left-most `X-Forwarded-For` entry, which the client writes, so any caller
   * can spoof an address and get a private bucket per request.
   *
   * Accepted forms (Fastify passes them to proxy-addr):
   *   - a hop count: "1" - trust exactly the N nearest proxies
   *   - a CIDR/IP allow-list: "10.0.0.0/8,172.16.0.0/12"
   *   - the named presets "loopback" / "linklocal" / "uniquelocal"
   *   - "false" (default) - no proxy, use the socket address
   */
  TRUST_PROXY: z.string().default("false"),
  /**
   * Session lifetime bounds, in minutes.
   *
   * `SESSION_TTL_DAYS` alone made every session a 30-day bearer credential: an
   * unattended browser stayed authenticated for a month, and a stolen cookie never
   * aged out. Idle expires a session that stops being used; absolute expires it
   * regardless of use.
   */
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(12 * 60),
  SESSION_ABSOLUTE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30 * 24 * 60),
  /** How often an active session's token is replaced (minutes). */
  SESSION_ROTATE_MINUTES: z.coerce.number().int().positive().default(60),
});

export type LogLevel = "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/** `LOG_LEVEL` is optional in the environment but always resolved on the loaded config. */
export type AppConfig = Omit<z.infer<typeof envSchema>, "LOG_LEVEL"> & { LOG_LEVEL: LogLevel };

const DEFAULT_LOG_LEVEL: Record<string, LogLevel> = {
  production: "info",
  development: "debug",
  test: "silent",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  const config: AppConfig = {
    ...parsed.data,
    LOG_LEVEL: parsed.data.LOG_LEVEL ?? DEFAULT_LOG_LEVEL[parsed.data.NODE_ENV] ?? "info",
  };

  // Production guards: fail fast instead of deploying a misconfigured instance.
  if (config.NODE_ENV === "production") {
    if (!config.COOKIE_SECURE) {
      throw new Error("COOKIE_SECURE must be 'true' in production");
    }
    if (config.SESSION_SECRET === "development-only-secret") {
      throw new Error("SESSION_SECRET must be set to a strong random value in production");
    }
    // The only previous check was equality with the known default, so SESSION_SECRET=x
    // booted cleanly. This key also signs preview tokens, and a preview URL is handed to
    // external reviewers by design - a weak key is brute-forceable offline into the
    // ability to mint a preview for any article on any site.
    if (config.SESSION_SECRET.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production");
    }
    if (config.ALLOW_PRIVATE_WEBHOOKS) {
      throw new Error("ALLOW_PRIVATE_WEBHOOKS must not be enabled in production");
    }
    if (config.LOG_LEVEL === "silent") {
      throw new Error("LOG_LEVEL must not be 'silent' in production");
    }
    // The rate limiter is the brute-force control and it keys on `req.ip`. A production
    // deployment is behind TLS termination of some kind, so this has to be a decision, not
    // a default: state the policy explicitly, including "direct" when there is no proxy.
    if (config.TRUST_PROXY === "false") {
      throw new Error(
        "TRUST_PROXY must state the reverse-proxy policy in production: a hop count (e.g. '1'), a CIDR allow-list, or 'direct' when the app is exposed without a proxy",
      );
    }
  }
  return config;
}

/**
 * Fastify's `trustProxy` value derived from TRUST_PROXY.
 *
 * `"direct"` and `"false"` both mean "the socket address is the client address"; the
 * difference is only that `"direct"` is an explicit statement, which is what production
 * requires. Everything else is handed to proxy-addr: a bare integer is a hop count, and
 * anything else is treated as a comma-separated list of trusted CIDRs/presets.
 */
export function trustProxySetting(config: AppConfig): boolean | number | string[] {
  const raw = config.TRUST_PROXY.trim();
  if (raw === "" || raw === "false" || raw === "direct") return false;
  if (raw === "true") {
    // Trusting every hop means trusting the client-written left-most XFF entry, which is
    // spoofable per request - strictly worse than no proxy at all for rate limiting.
    throw new Error("TRUST_PROXY=true is not accepted: give a hop count (e.g. '1') or a CIDR allow-list");
  }
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Comma-separated allow-list of CORS origins (falls back to APP_BASE_URL). */
export function corsOrigins(config: AppConfig): string[] {
  const raw = config.CORS_ORIGINS.trim();
  if (raw.length > 0) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [config.APP_BASE_URL];
}
