import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://kalel:kalel@localhost:5432/kalel"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  NODE_ENV: z.string().default("development"),
  ALLOW_PRIVATE_WEBHOOKS: z.string().optional(),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid worker environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  const config = parsed.data;
  // The API refuses to boot with this set in production. The guard belonged here too: the
  // API is the process that *registers* webhooks, but the worker is the process that makes
  // the outbound requests, and it is the flag on this side that disables the delivery-time
  // SSRF re-check. Any deployment sharing one env file across api+worker would have had
  // the API boot clean while the worker silently delivered to private addresses.
  if (config.NODE_ENV === "production" && config.ALLOW_PRIVATE_WEBHOOKS === "true") {
    throw new Error("ALLOW_PRIVATE_WEBHOOKS cannot be enabled in production");
  }
  return config;
}
