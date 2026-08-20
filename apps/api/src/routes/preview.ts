import type { FastifyInstance } from "fastify";
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

  // The preview page is unauthenticated, so it cannot read the session-guarded media
  // route. This serves the same bytes under the preview token, limited to the media the
  // previewed article shows.
  app.get("/v1/preview/:token/media/:mediaId/file", async (req, reply) => {
    const { token, mediaId } = req.params as { token: string; mediaId: string };
    const payload = verifyPreviewToken(app.config.SESSION_SECRET, token);
    if (!payload) throw unauthorized("invalid or expired preview token");
    const mediaRow = await resolvePreviewMedia(app.db, payload, mediaId);
    const buf = await app.storage.get(mediaRow.storageKey);
    if (!buf) throw notFound("media not found");
    return reply
      .header("x-robots-tag", "noindex, nofollow")
      // helmet marks every response same-origin; the preview page is served by the CMS,
      // a different origin than the API, and would otherwise not render these images.
      .header("cross-origin-resource-policy", "cross-origin")
      .type(mediaRow.mimeType)
      .send(buf);
  });
}
