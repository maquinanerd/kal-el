import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://kalel:kalel@localhost:5432/kalel"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid worker environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  return parsed.data;
}
