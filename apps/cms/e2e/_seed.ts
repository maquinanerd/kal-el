import type { Page } from "@playwright/test";

export const API = "http://localhost:3101";

/** A minimal but genuinely valid GIF - the upload path verifies magic bytes. */
export const PIXEL_GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0];

/** The CSRF token is deliberately not httpOnly so the app can echo it back. */
async function csrf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = document.cookie.split("; ").find((c) => c.startsWith("ke_csrf="));
    return raw ? decodeURIComponent(raw.slice("ke_csrf=".length)) : "";
  });
}

export async function activeSiteId(page: Page): Promise<string> {
  return page.evaluate(async (api) => {
    const res = await fetch(`${api}/v1/me/sites`, { credentials: "include" });
    const json = await res.json();
    return json.data[0].id as string;
  }, API);
}

/**
 * Seeds one media asset through the API.
 *
 * Media Detail could not be included in the visual or accessibility sweep because a fresh
 * database has an empty library and the surface needs an id. Seeding here lets those
 * sweeps cover it.
 */
export async function seedMedia(page: Page, filename = "pixel.gif"): Promise<{ id: string; siteId: string }> {
  const token = await csrf(page);
  const siteId = await activeSiteId(page);
  return page.evaluate(
    async ({ api, site, name, bytes, csrfToken }) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/gif" }), name);
      const res = await fetch(`${api}/v1/sites/${site}/media`, {
        method: "POST",
        credentials: "include",
        headers: { "x-kal-el-csrf": csrfToken },
        body: form,
      });
      if (!res.ok) throw new Error(`seedMedia failed: HTTP ${res.status}`);
      const json = await res.json();
      return { id: json.data.id as string, siteId: site };
    },
    { api: API, site: siteId, name: filename, bytes: PIXEL_GIF, csrfToken: token },
  );
}

/** Read an article straight from the API, to assert what was actually persisted. */
export async function readArticle(page: Page, siteId: string, articleId: string) {
  return page.evaluate(
    async ({ api, site, id }) => {
      const res = await fetch(`${api}/v1/sites/${site}/articles/${id}`, { credentials: "include" });
      return (await res.json()).data;
    },
    { api: API, site: siteId, id: articleId },
  );
}
