import { expect, test } from "@playwright/test";

import { API, PIXEL_GIF, activeSiteId, readArticle } from "./_seed";

/**
 * Browser coverage for the media surfaces. The staging audit recorded these as covered at
 * the API level only.
 */
test.describe("media library", () => {
  test("uploads through the UI, keeps metadata, and survives a reload", async ({ page }) => {
    await page.goto("/media");
    await expect(page.getByRole("button", { name: /Enviar/ })).toBeVisible({ timeout: 30_000 });

    const name = `capa-${Date.now()}.gif`;
    await page.locator("input[type=file]").setInputFiles({
      name,
      mimeType: "image/gif",
      buffer: Buffer.from(PIXEL_GIF),
    });

    // the grid renders each asset as a button, not a link
    const card = page.getByRole("button", { name: `Abrir ${name}` });
    await expect(card, "the uploaded asset must appear in the library").toBeVisible({ timeout: 30_000 });

    // open the detail surface and write metadata
    await card.click();
    await expect(page).toHaveURL(/\/media\/[0-9a-f-]+/, { timeout: 30_000 });

    await page.getByRole("textbox", { name: /Alt text/ }).first().fill("Cartaz do filme");
    await page.getByRole("textbox", { name: /Legenda/ }).first().fill("Divulgação");
    await page.getByRole("textbox", { name: /Crédito/ }).first().fill("Estúdio");
    await page.getByRole("spinbutton", { name: /Ponto focal X/ }).fill("0.4");
    await page.getByRole("spinbutton", { name: /Ponto focal Y/ }).fill("0.25");
    await page.getByRole("button", { name: /Salvar/ }).first().click();

    await page.reload();
    await expect(page.getByRole("textbox", { name: /Alt text/ }).first()).toHaveValue("Cartaz do filme", {
      timeout: 30_000,
    });
    await expect(page.getByRole("textbox", { name: /Crédito/ }).first()).toHaveValue("Estúdio");
    // focal point is metadata only - stored, never used to transform the binary
    await expect(page.getByRole("spinbutton", { name: /Ponto focal X/ })).toHaveValue("0.4");
  });

  test("an uploaded asset can be set as the featured image and persists", async ({ page }) => {
    await page.goto("/media");
    const name = `destaque-${Date.now()}.gif`;
    await page.locator("input[type=file]").setInputFiles({
      name,
      mimeType: "image/gif",
      buffer: Buffer.from(PIXEL_GIF),
    });
    await expect(page.getByRole("button", { name: `Abrir ${name}` })).toBeVisible({ timeout: 30_000 });

    await page.goto("/articles");
    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
    const articleId = page.url().split("/articles/")[1] ?? "";
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Novo artigo", { timeout: 30_000 });

    await page.getByRole("button", { name: "Selecionar imagem de destaque" }).click();
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
