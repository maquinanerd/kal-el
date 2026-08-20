import { expect, test, type Page } from "@playwright/test";

// 1x1 red PNG — small enough to inline, real enough for the API's dimension probe.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("owner@kalel.dev");
  await page.getByLabel("Senha").fill("kalel-dev-password-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/articles/, { timeout: 15_000 });
}

async function newArticle(page: Page) {
  // Two specs creating "Novo artigo" at the same instant can collide on the derived
  // slug (uniqueSlug reads-then-writes), so retry the transient conflict.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    const landed = await page
      .waitForURL(/\/articles\/[0-9a-f-]+/, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) break;
  }
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/);
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Novo artigo", { timeout: 15_000 });
}

test.describe("attaching images while writing", () => {
  test("uploads from the toolbar without leaving the article", async ({ page }) => {
    await login(page);
    await newArticle(page);

    const editor = page.locator(".peg-editor__surface .ProseMirror");
    await editor.click();
    await page.keyboard.type("Parágrafo antes da imagem.");

    // The toolbar button opens a native file dialog — intercept it and hand over a real file.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Inserir imagem do computador" }).click();
    (await chooser).setFiles([{ name: "foto-e2e.png", mimeType: "image/png", buffer: PNG }]);

    // The image lands in the body and actually renders (src resolved, not an empty box).
    await expect(page.locator(".peg-editor__atom--image")).toBeVisible({ timeout: 20_000 });
    const inserted = page.locator(".peg-editor__atom--image img");
    await expect(inserted).toHaveAttribute("src", /\/media\/[0-9a-f-]+\/file$/, { timeout: 20_000 });
    await expect(inserted).toBeVisible();

    // The text written before the image is still there, and the caret sits after the
    // image so writing simply continues — inserting must never eat the author's work.
    await expect(editor).toContainText("Parágrafo antes da imagem.");
    await page.keyboard.type("E o texto continua depois da imagem.");

    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 20_000 });

    // Persisted: image and both paragraphs survive a reload.
    await page.reload();
    await expect(page.locator(".peg-editor__atom--image img")).toBeVisible({ timeout: 20_000 });
    await expect(editor).toContainText("Parágrafo antes da imagem.");
    await expect(editor).toContainText("E o texto continua depois da imagem.");
  });

  test("uploads from inside the media picker", async ({ page }) => {
    await login(page);
    await newArticle(page);

    await page.getByRole("button", { name: "Inserir imagem da biblioteca" }).click();
    await expect(page.getByRole("dialog", { name: "Selecionar imagem" })).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Enviar do computador" }).click();
    (await chooser).setFiles([{ name: "picker-e2e.png", mimeType: "image/png", buffer: PNG }]);

    // The upload auto-selects, so "Selecionar" becomes usable without a trip to Mídia.
    const confirm = page.getByRole("dialog", { name: "Selecionar imagem" }).getByRole("button", { name: "Selecionar", exact: true });
    await expect(confirm).toBeEnabled({ timeout: 20_000 });
    await confirm.click();

    await expect(page.locator(".peg-editor__atom--image img")).toBeVisible({ timeout: 20_000 });
  });

  test("shows the image in the article preview", async ({ page, context }) => {
    await login(page);
    await newArticle(page);

    await page.locator(".peg-editor__surface .ProseMirror").click();
    await page.keyboard.type("Corpo com imagem.");

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Inserir imagem do computador" }).click();
    (await chooser).setFiles([{ name: "preview-e2e.png", mimeType: "image/png", buffer: PNG }]);
    await expect(page.locator(".peg-editor__atom--image img")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 20_000 });

    // Preview opens the rendered page in a new tab — not the JSON endpoint.
    const opened = context.waitForEvent("page");
    await page.getByRole("button", { name: "Preview" }).click();
    const preview = await opened;
    await preview.waitForLoadState();
    await expect(preview).toHaveURL(/\/preview\/kpv\./);
    await expect(preview.getByText("Corpo com imagem.")).toBeVisible({ timeout: 20_000 });

    // The image is served through the preview token and actually decodes.
    const img = preview.locator("article figure img");
    await expect(img).toHaveAttribute("src", /\/v1\/preview\/kpv\.[^/]+\/media\/[0-9a-f-]+\/file$/);
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });
});
