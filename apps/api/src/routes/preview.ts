import type { FastifyInstance } from "fastify";
import { uuidSchema } from "@kal-el/contracts";
import { notFound, unauthorized } from "../plugins/errors.js";
import { resolvePreview, resolvePreviewMedia, verifyPreviewToken } from "../services/preview.js";

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

  // Body images for the preview renderer. The session-guarded media route is
  // unreachable here (a preview is opened without a session), so the token itself
  // scopes access — and only to media its own article references.
  app.get("/v1/preview/:token/media/:mediaId", async (req, reply) => {
    const { token, mediaId } = req.params as { token: string; mediaId: string };
    const payload = verifyPreviewToken(app.config.SESSION_SECRET, token);
    if (!payload) throw unauthorized("invalid or expired preview token");
    if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");

    const row = await resolvePreviewMedia(app.db, payload, mediaId);
    const buf = await app.storage.get(row.storageKey);
    if (!buf) throw notFound("media not found");

    return reply
      // Helmet marks every response `same-origin`, which stops the CMS (a different
      // origin than the API) from rendering media in <img>.
      .header("cross-origin-resource-policy", "cross-origin")
      .header("x-robots-tag", "noindex, nofollow")
      // Tokens expire in 15 min; let the browser reuse the bytes within one preview
      // session but keep them out of shared caches.
      .header("cache-control", "private, max-age=300")
      .type(row.mimeType)
      .send(buf);
  });
}
