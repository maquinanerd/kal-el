import type { FastifyInstance } from "fastify";
import { unauthorized } from "../plugins/errors.js";
import { resolvePreview, verifyPreviewToken } from "../services/preview.js";

export async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/preview/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const payload = verifyPreviewToken(app.config.SESSION_SECRET, token);
    if (!payload) throw unauthorized("invalid or expired preview token");
    const data = await resolvePreview(app.db, payload);
    // never index previews
    reply.header("x-robots-tag", "noindex, nofollow");
    return { data };
  });
}
