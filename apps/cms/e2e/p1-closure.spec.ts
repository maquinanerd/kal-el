import { expect, test, type Page } from "@playwright/test";

import { CREDENTIALS } from "./_surfaces";

/**
 * The six P1 defects the second product review left open, each exercised through the real
 * UI the reviewer used. Every one of them looked like a styling problem and was not:
 * lists and quotes were never created, the slug lifecycle was switched off by the
 * server's own deduplication, the link dialog could not see the link the caret was in,
 * and the mobile drawer's identity row was a logout button.
 */

async function openNewArticle(page: Page) {
  await page.goto("/articles");
  await expect(page.getByRole("button", { name: "Novo artigo" }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Novo artigo" }).first().click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(page.getByLabel("Título do artigo")).toHaveValue("Novo artigo", { timeout: 30_000 });

  const editor = page.locator(".peg-editor__surface .ProseMirror");
  await editor.click();
  return editor;
}

test.describe("P1-1 — lists and quotes are structure, not paragraphs", () => {
  test("bullet list, ordered list and quote render as themselves in the editor", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("Item um");
    await page.getByRole("button", { name: "Lista com marcadores" }).click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Item dois");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Item três");

    await expect(editor.locator("ul > li"), "three real list items").toHaveCount(3);
    await expect(editor.locator("ul > li").nth(2)).toContainText("Item três");

    // A marker the reader can actually see. The complaint was that a list looked like a
    // paragraph, so assert the computed style, not just the tag.
    const listStyle = await editor.locator("ul").first().evaluate((el) => getComputedStyle(el).listStyleType);
    expect(listStyle, "an unordered list must show a marker").toBe("disc");
    const indent = await editor.locator("ul").first().evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(indent, "and be indented").toBeGreaterThan(8);

    // ordered list, on its own line
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Lista com marcadores" }).click(); // leave the bullet list
    await page.keyboard.type("Primeiro");
    await page.getByRole("button", { name: "Lista numerada" }).click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Segundo");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Terceiro");

    await expect(editor.locator("ol > li")).toHaveCount(3);
    const olStyle = await editor.locator("ol").first().evaluate((el) => getComputedStyle(el).listStyleType);
    expect(olStyle, "an ordered list must be numbered").toBe("decimal");

    // quote
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Lista numerada" }).click(); // leave the ordered list
    await page.keyboard.type("Uma citação que precisa ser distinguível.");
    await page.getByRole("button", { name: "Citação" }).click();

    await expect(editor.locator("blockquote")).toHaveCount(1);
    await expect(editor.locator("blockquote")).toContainText("Uma citação");
    const rail = await editor
      .locator("blockquote")
      .evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth));
    expect(rail, "a quote needs a visible editorial rail").toBeGreaterThanOrEqual(2);
  });

  test("the preview shows the same structure the editor does", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("Item um");
    await page.getByRole("button", { name: "Lista com marcadores" }).click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Item dois");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Item três");
    await expect(editor.locator("ul > li")).toHaveCount(3);

    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 25_000 });

    await page.getByRole("button", { name: "Preview" }).click();
    const frame = page.frameLocator(".kalel-preview__iframe");
    await expect(frame.locator("article ul > li"), "the preview must not flatten the list").toHaveCount(3, {
      timeout: 25_000,
    });
    const previewMarker = await frame
      .locator("article ul")
      .first()
      .evaluate((el) => getComputedStyle(el).listStyleType);
    expect(previewMarker).toBe("disc");
  });
});

test.describe("P1-2 — the slug lifecycle", () => {
  test("is automatic at birth, locks on a real edit, and can be released again", async ({ page }) => {
    await openNewArticle(page);

    const slug = page.getByLabel("Slug");
    const autoHint = page.getByText("Gerado a partir do título. Editar aqui congela o valor.");
    const manualHint = page.getByText("Definido manualmente");

    // A brand new article is AUTOMATIC, even when the server had to deduplicate its slug.
    await expect(autoHint).toBeVisible();
    await expect(manualHint).toHaveCount(0);

    const title = page.getByLabel("Título do artigo");
    await title.fill("Acceptance Slug Automatic");
    await expect(slug, "the slug follows the title").toHaveValue(/^acceptance-slug-automatic(-\d+)?$/, {
      timeout: 15_000,
    });
    await expect(autoHint).toBeVisible();
    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 25_000 });

    // A real edit claims it.
    await slug.fill("custom-slug");
    await expect(manualHint).toBeVisible();

    await title.fill("Outro Título Completamente Diferente");
    await page.waitForTimeout(600);
    await expect(slug, "a manual slug is the writer's").toHaveValue("custom-slug");

    // And there is an explicit way back.
    await page.getByRole("button", { name: "Gerar a partir do título" }).click();
    await expect(slug).toHaveValue(/^outro-titulo-completamente-diferente(-\d+)?$/);
    await expect(autoHint).toBeVisible();
  });
});

test.describe("P1-3 — collapsed mark toggles", () => {
  test("Ctrl+B marks only what is typed while it is on", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("AAA ");
    await page.keyboard.press("Control+b");
    await page.keyboard.type("BBB");
    await page.keyboard.press("Control+b");
    await page.keyboard.type(" CCC");

    await expect(editor.locator("strong")).toHaveCount(1);
    await expect(editor.locator("strong"), "turning bold off must not unmark BBB").toHaveText("BBB");
    await expect(editor.locator("p").first()).toHaveText("AAA BBB CCC");
  });

  test("Ctrl+I behaves the same", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("AAA ");
    await page.keyboard.press("Control+i");
    await page.keyboard.type("BBB");
    await page.keyboard.press("Control+i");
    await page.keyboard.type(" CCC");

    await expect(editor.locator("em")).toHaveCount(1);
    await expect(editor.locator("em")).toHaveText("BBB");
    await expect(editor.locator("p").first()).toHaveText("AAA BBB CCC");
  });
});

test.describe("P1-4 — editing and removing a link", () => {
  test("reopens with the current URL and removes the link without eating the text", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("OpenAI");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Control+k");

    const dialog = page.getByRole("dialog", { name: "Link" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("URL").fill("https://example.test/");
    await dialog.getByRole("button", { name: "Aplicar" }).click();

    // The dialog must be gone before the keyboard is driven again: it holds a focus trap,
    // and keys pressed while it unmounts go to its buttons, not to the article.
    await expect(dialog).toBeHidden();
    const link = editor.locator("a[href='https://example.test/']");
    await expect(link).toHaveText("OpenAI");

    // Reopen ON the link: the URL must already be there.
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByLabel("URL"), "the dialog must load the current URL").toHaveValue(
      "https://example.test/",
    );

    const remove = dialog.getByRole("button", { name: "Remover link" });
    await expect(remove, "removing a link must be reachable").toBeVisible();
    await remove.click();

    await expect(editor.locator("a")).toHaveCount(0);
    await expect(editor, "the text survives its link").toContainText("OpenAI");
  });

  test("the bubble toolbar reflects that the selection is a link", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("Referência");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Link" });
    await dialog.getByLabel("URL").fill("https://example.test/ref");
    await dialog.getByRole("button", { name: "Aplicar" }).click();
    await expect(dialog).toBeHidden();
    await expect(editor.locator("a")).toHaveCount(1);
    // applying a link must hand the writing surface back, or the next keystroke is lost
    await expect(editor).toBeFocused();

    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const toolbar = page.getByRole("toolbar", { name: "Formatação da seleção" });
    await expect(toolbar).toBeVisible({ timeout: 10_000 });
    await expect(toolbar.getByRole("button", { name: "Editar link" })).toHaveAttribute("aria-pressed", "true");

    await toolbar.getByRole("button", { name: "Remover link" }).click();
    await expect(editor.locator("a")).toHaveCount(0);
    await expect(editor).toContainText("Referência");
  });
});

test.describe("P1-6 — the reason a block happened", () => {
  test("a blocked article shows the reviewer's note to whoever opens it", async ({ page }) => {
    await openNewArticle(page);
    await page.getByLabel("Título do artigo").fill("Artigo Bloqueado Com Motivo");
    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 25_000 });

    await page.getByRole("button", { name: "Enviar p/ revisão" }).click();
    const submitDialog = page.getByRole("dialog");
    await expect(submitDialog).toBeVisible({ timeout: 10_000 });
    await submitDialog.getByRole("button", { name: "Enviar p/ revisão" }).click();
    await expect(page.getByRole("button", { name: "Solicitar alterações" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Solicitar alterações" }).click();
    const rejectDialog = page.getByRole("dialog");
    await expect(rejectDialog).toBeVisible({ timeout: 10_000 });
    await rejectDialog.getByRole("textbox").fill("Rever a introdução antes de reenviar.");
    await rejectDialog.getByRole("button", { name: "Solicitar alterações" }).click();

    const banner = page.getByRole("alert").filter({ hasText: "Alterações solicitadas" });
    await expect(banner, "the author must see WHY, not just that it is blocked").toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText("Rever a introdução antes de reenviar.");
    await expect(banner, "and who asked").toContainText("Owner");

    // It survives a reload: the note is read back from the audit trail, not held in memory.
    await page.reload();
    const reloaded = page.getByRole("alert").filter({ hasText: "Alterações solicitadas" });
    await expect(reloaded).toBeVisible({ timeout: 25_000 });
    await expect(reloaded).toContainText("Rever a introdução antes de reenviar.");

    // And the way out still works.
    await expect(page.getByRole("button", { name: "Reenviar p/ revisão" })).toBeVisible();
  });
});

test.describe("P1-5 — identity is not a logout button", () => {
  /*
   * Runs in its own context with its own session. Signing out revokes the session on the
   * server and the rest of the suite shares one, so clicking "Sair" on the shared session
   * would log the whole run out.
   */
  test("tapping the account row at 390px does not end the session; Sair does", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await page.goto("http://localhost:3100/login");
      await page.getByLabel("E-mail").fill(CREDENTIALS.email);
      await page.getByLabel("Senha").fill(CREDENTIALS.password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await expect(page).toHaveURL(/\/articles/, { timeout: 30_000 });

      await page.getByRole("button", { name: "Abrir navegação" }).click();
      const drawer = page.locator(".peg-sidebar");
      await expect(drawer).toHaveClass(/peg-sidebar--open/);

      // The identity row states who you are; it must not be a control at all.
      const identity = drawer.locator(".peg-account__identity");
      await expect(identity).toBeVisible();
      await expect(identity).toContainText("Owner");
      await expect(identity).toContainText(CREDENTIALS.email);
      expect(await identity.locator("button").count(), "identity must not be a button").toBe(0);

      await identity.click();
      await page.waitForTimeout(1000);
      await expect(page, "tapping the account row must not sign anyone out").not.toHaveURL(/\/login/);

      // The explicit action, and only it, ends the session.
      const signOut = drawer.getByRole("button", { name: "Sair" });
      await expect(signOut).toBeVisible();
      await signOut.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    } finally {
      await context.close();
    }
  });
});
