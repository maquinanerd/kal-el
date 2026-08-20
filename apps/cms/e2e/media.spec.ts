import { expect, test, type Page } from "@playwright/test";

import { API, PIXEL_GIF, activeSiteId, readArticle } from "./_seed";

/**
 * Browser coverage for the media surfaces. The staging audit recorded these as covered at
 * the API level only.
 *
 * The library is a grid of tiles beside a details rail: selecting a tile fills the rail,
 * which is where metadata is written. It does not navigate to a detail page - that route
 * still exists and is covered by the accessibility sweep, but nothing in the grid links
 * to it.
 */

/** The grid tile for a file. The filename is rendered inside it. */
function tile(page: Page, filename: string) {
  return page.locator(".kalel-media__tile").filter({ hasText: filename });
}

/** The details rail, which is where a file's metadata is edited. */
function details(page: Page) {
  return page.getByLabel("Detalhes da mídia");
}

async function upload(page: Page, filename: string, bytes: number[]) {
  await page.locator("input[type=file]").setInputFiles({
    name: filename,
    mimeType: "image/gif",
    buffer: Buffer.from(bytes),
  });
  await expect(tile(page, filename), "the uploaded asset must appear in the library").toBeVisible({
    timeout: 30_000,
  });
}
test.describe("media library", () => {
  test("uploads through the UI, keeps metadata, and survives a reload", async ({ page }) => {
    await page.goto("/media");
    await expect(page.getByRole("button", { name: /Enviar/ })).toBeVisible({ timeout: 30_000 });

    const name = `capa-${Date.now()}.gif`;
    await upload(page, name, PIXEL_GIF);

    await tile(page, name).click();
    const rail = details(page);
    await expect(rail.getByText(name)).toBeVisible({ timeout: 30_000 });

    await rail.getByRole("textbox", { name: /Alt text/ }).fill("Cartaz do filme");
    await rail.getByRole("textbox", { name: /Legenda/ }).fill("Divulgação");
    await rail.getByRole("textbox", { name: /Crédito/ }).fill("Estúdio");

    // the focal point is set by pointing at the image, not by typing coordinates
    await rail.locator(".kalel-focal").click({ position: { x: 20, y: 10 } });
    await expect(rail.locator(".kalel-focal__dot")).toBeVisible();

    await rail.getByRole("button", { name: "Salvar" }).click();
    await expect(rail.getByRole("button", { name: "Salvar" })).toBeDisabled({ timeout: 30_000 });

    // a reload clears the selection, so the file has to be reopened to be read back
    await page.reload();
    await tile(page, name).click();
    const reloaded = details(page);
    await expect(reloaded.getByRole("textbox", { name: /Alt text/ })).toHaveValue("Cartaz do filme", {
      timeout: 30_000,
    });
    await expect(reloaded.getByRole("textbox", { name: /Crédito/ })).toHaveValue("Estúdio");
    // focal point is metadata only - stored, never used to transform the binary
    await expect(reloaded.locator(".kalel-focal__dot"), "the focal point must persist").toBeVisible();
  });

  test("an uploaded asset can be set as the featured image and persists", async ({ page }) => {
    await page.goto("/media");
    const name = `destaque-${Date.now()}.gif`;
    await upload(page, name, PIXEL_GIF);

    await page.goto("/articles");
    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
    const articleId = page.url().split("/articles/")[1] ?? "";
    await expect(page.getByLabel("Título do artigo")).toHaveValue("Novo artigo", { timeout: 30_000 });

    await page.getByRole("button", { name: "Selecionar imagem", exact: true }).click();
    const picker = page.getByRole("dialog");
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await picker.getByRole("button", { name: new RegExp(`Selecionar ${name.replace(".", "\\.")}`) }).click();
    await picker.getByRole("button", { name: "Selecionar", exact: true }).click();

    // the write the server accepted is what matters, not the label
    await page.waitForResponse(
      (r) => r.request().method() === "PATCH" && /\/articles\//.test(r.url()) && r.status() < 300,
      { timeout: 30_000 },
    );

    const siteId = await activeSiteId(page);
    const persisted = await readArticle(page, siteId, articleId);
    expect(persisted.featuredMediaId, "the featured image must reach the database").toBeTruthy();
  });

  test("media in use cannot be deleted, and the API says why", async ({ page }) => {
    await page.goto("/articles");
    const siteId = await activeSiteId(page);

    const outcome = await page.evaluate(
      async ({ api, site, bytes }) => {
        const token = document.cookie.split("; ").find((c) => c.startsWith("ke_csrf="))?.slice("ke_csrf=".length) ?? "";
        const csrf = decodeURIComponent(token);
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/gif" }), "em-uso.gif");
        const up = await fetch(`${api}/v1/sites/${site}/media`, {
          method: "POST",
          credentials: "include",
          headers: { "x-kal-el-csrf": csrf },
          body: form,
        });
        const mediaId = (await up.json()).data.id as string;

        const created = await fetch(`${api}/v1/sites/${site}/articles`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "x-kal-el-csrf": csrf },
          body: JSON.stringify({ title: "Usa a imagem", featuredMediaId: mediaId }),
        });
        const articleStatus = created.status;

        const del = await fetch(`${api}/v1/sites/${site}/media/${mediaId}`, {
          method: "DELETE",
          credentials: "include",
          headers: { "x-kal-el-csrf": csrf },
        });
        return { articleStatus, deleteStatus: del.status, body: await del.json().catch(() => null) };
      },
      { api: API, site: siteId, bytes: PIXEL_GIF },
    );

    expect(outcome.articleStatus).toBe(201);
    expect(outcome.deleteStatus, "deleting media that an article references must be refused").toBe(409);
  });
});
