import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  const config = parsed.data;

  // Production guards: fail fast instead of deploying a misconfigured instance.
  if (config.NODE_ENV === "production") {
    if (!config.COOKIE_SECURE) {
      throw new Error("COOKIE_SECURE must be 'true' in production");
    }
    if (config.SESSION_SECRET === "development-only-secret") {
      throw new Error("SESSION_SECRET must be set to a strong random value in production");
    }
  }
  return config;
}

/** Comma-separated allow-list of CORS origins (falls back to APP_BASE_URL). */
export function corsOrigins(config: AppConfig): string[] {
  const raw = config.CORS_ORIGINS.trim();
  if (raw.length > 0) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [config.APP_BASE_URL];
}
