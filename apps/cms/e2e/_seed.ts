import type { Page } from "@playwright/test";

export const API = "http://localhost:3101";

/**
 * A 1x1 GIF that browsers can actually decode.
 *
 * The previous fixture was 13 bytes: a GIF header and nothing else. It passed the upload
 * path's magic-byte check and stored 1x1 dimensions, so API-level assertions were happy -
 * but no browser could decode it, every <img> pointing at it was a broken image with no
 * intrinsic size, and any element sized by that image collapsed to zero height and
 * counted as invisible. The focal-point picker in the media rail is exactly such an
 * element, and could not be clicked.
 *
 * This is the canonical 43-byte transparent pixel: header, logical screen descriptor,
 * global colour table, graphic control extension, image descriptor, one byte of LZW data,
 * trailer.
 */
export const PIXEL_GIF = [
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00, // 1 x 1
  0x80, 0x00, 0x00, // global colour table, 2 entries
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, // black, white
  0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // graphic control extension
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
  0x02, 0x02, 0x44, 0x01, 0x00, // LZW-encoded image data
  0x3b, // trailer
];

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
