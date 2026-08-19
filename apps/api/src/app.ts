import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { buildOpenApiDocument } from "@kal-el/contracts";
import { requestId } from "@kal-el/auth";

import type { AppConfig } from "./config.js";
import { corsOrigins, trustProxySetting } from "./config.js";
import { loggerOptions, registerRequestLogging } from "./logging.js";
import type { StorageProvider } from "./storage/provider.js";
import { createStorageProvider } from "./storage/index.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { dbPlugin } from "./plugins/db.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { siteRoutes } from "./routes/site.js";
import { previewRoutes } from "./routes/preview.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    storage: StorageProvider;
  }
}

export async function buildApp(opts: { connectionString: string; config: AppConfig; logger?: boolean }): Promise<FastifyInstance> {
  // `logger: false` was the default, so every real deployment booted with a no-op logger.
  // The logger is now always on; LOG_LEVEL=silent is the only way to quieten it and
  // production refuses to boot with that. `opts.logger === false` is honoured for tests
  // that assert on stdout.
  const app = Fastify({
    logger: opts.logger === false ? false : (loggerOptions(opts.config) as never),
    // Behind a proxy `req.ip` is the proxy unless this says otherwise, and `req.ip` is
    // what the rate limiter buckets on.
    trustProxy: trustProxySetting(opts.config),
    genReqId: () => requestId(),
    bodyLimit: 5 * 1024 * 1024,
    maxParamLength: 1024,
  });
  app.decorate("config", opts.config);
  app.decorate("storage", createStorageProvider(opts.config));
  registerErrorHandler(app);
  if (opts.logger !== false) registerRequestLogging(app);

  await app.register(cookie);
  await app.register(cors, {
    origin: corsOrigins(opts.config),
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-kal-el-csrf", "if-match", "idempotency-key"],
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  // Global per-IP ceiling. Login and bootstrap keep their own, much stricter, route-level
  // limits (see routes/auth.ts) - those are the credential-guessing surfaces and must not
  // inherit this one. Service tokens are bucketed by token rather than by IP, so one
  // integration behind a shared egress address cannot exhaust the budget of another.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (typeof auth === "string" && auth.startsWith("Bearer ke_st.")) {
        // the token itself, hashed by the limiter's own store key - never logged
        return `svc:${auth.slice(-24)}`;
      }
      return req.ip;
    },
  });
  await app.register(multipart, { limits: { files: 1, fileSize: opts.config.MEDIA_MAX_BYTES } });
  await app.register(dbPlugin, { connectionString: opts.connectionString });
  await app.register(authPlugin);

  await app.register(swagger, { openapi: buildOpenApiDocument() as never });
  // Swagger UI is opt-in; disabled by default in production.
  if (opts.config.ENABLE_DOCS || opts.config.NODE_ENV !== "production") {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(siteRoutes);
  await app.register(previewRoutes);

  return app;
}
