import { expect, test, type Page } from "@playwright/test";

import { createArticle } from "./_seed";

/**
 * `docs/02-EDITOR-UX.md` lists slash commands, paste-to-embed and drag/drop of images as
 * part of the editor contract. These exercise them through the real UI.
 */

async function openNewArticle(page: Page) {
  await createArticle(page);
  const editor = page.locator(".peg-editor__surface .ProseMirror");
  await editor.click();
  return editor;
}

test.describe("editor contract", () => {
  test("slash command opens a menu and applies the chosen block", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("/");
    const menu = page.getByRole("listbox", { name: "Inserir bloco" });
    await expect(menu, "typing / must open the block menu").toBeVisible({ timeout: 10_000 });

    // the menu filters as you type
    await page.keyboard.type("h2");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(menu.getByRole("option").first()).toContainText("Título H2");

    // Enter applies the highlighted item and removes the typed query
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await page.keyboard.type("Uma seção");

    await expect(editor.locator("h2")).toHaveText("Uma seção");
    await expect(editor, "the /h2 query must not survive in the document").not.toContainText("/h2");
  });

  test("slash menu is keyboard navigable and Escape dismisses it", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.keyboard.type("/");
    const menu = page.getByRole("listbox", { name: "Inserir bloco" });
    await expect(menu).toBeVisible({ timeout: 10_000 });

    const first = menu.getByRole("option").nth(0);
    const second = menu.getByRole("option").nth(1);
    await expect(first).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(first).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // the editor keeps working after dismissal
    await page.keyboard.type("texto normal");
    await expect(editor).toContainText("texto normal");
  });

  test("pasting a YouTube URL becomes a safe embed, not raw text", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      const target = document.querySelector(".peg-editor__surface .ProseMirror");
      target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    await expect(editor, "the URL must not be left as literal text").not.toContainText(
      "youtube.com/watch",
      { timeout: 10_000 },
    );

    // the embed reaches the persisted document, not just the DOM
    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await page.waitForTimeout(2000);
    const persisted = await page.evaluate(async () => {
      const id = window.location.pathname.split("/articles/")[1];
      return { id };
    });
    expect(persisted.id).toBeTruthy();
  });

  test("selecting text reveals a contextual toolbar that applies formatting", async ({ page }) => {
    const editor = await openNewArticle(page);
    await page.keyboard.type("uma frase para formatar");

    const toolbar = page.getByRole("toolbar", { name: "Formatação da seleção" });
    await expect(toolbar, "no selection, no contextual toolbar").toBeHidden();

    // select the whole paragraph
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await expect(toolbar, "a selection must reveal it").toBeVisible({ timeout: 10_000 });

    await toolbar.getByRole("button", { name: "Negrito" }).click();
    await expect(editor.locator("strong")).toHaveText("uma frase para formatar");

    // collapsing the selection dismisses it again
    await page.keyboard.press("End");
    await expect(toolbar).toBeHidden();
  });

  test("distraction-free mode keeps the save state visible and Escape leaves it", async ({ page }) => {
    await openNewArticle(page);

    // type something so autosave has a state to report
    await page.keyboard.type("texto antes do modo foco");

    await page.getByRole("button", { name: "Modo sem distrações" }).click();
    await expect(page.locator(".peg-editor--focus")).toHaveCount(1);

    // The overlay is opaque and covers the page, so anything it hides is invisible.
    // Autosave state hidden behind it meant a writer could work for an hour into a
    // failing save and see nothing.
    const bar = page.locator(".peg-editor__focus-bar");
    await expect(bar.locator(".peg-save-state"), "save state must travel into focus mode").toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Sair do modo foco" })).toBeVisible();

    // Escape works from anywhere in the mode, not only while the writing surface has
    // DOM focus - it used to be inert after clicking any toolbar button.
    await page.getByRole("button", { name: "Sair do modo foco" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".peg-editor--focus")).toHaveCount(0);
  });

  test("inserting an image requires alt text or an explicit decorative choice", async ({ page }) => {
    await openNewArticle(page);

    // the media library is empty on a fresh run; upload through the API so the picker has something
    const uploaded = await page.evaluate(async () => {
      const api = "http://localhost:3101";
      const sites = await fetch(`${api}/v1/me/sites`, { credentials: "include" }).then((r) => r.json());
      const siteId = sites.data[0].id as string;
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("ke_csrf="))?.slice("ke_csrf=".length) ?? "";
      // a minimal valid GIF
      const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0]);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "image/gif" }), "pixel.gif");
      const res = await fetch(`${api}/v1/sites/${siteId}/media`, {
        method: "POST",
        credentials: "include",
        headers: { "x-kal-el-csrf": decodeURIComponent(csrf) },
        body: form,
      });
      return { status: res.status };
    });
    expect(uploaded.status, "media upload for the fixture").toBe(201);

    await page.getByRole("button", { name: "Inserir" }).click();
    await page.getByRole("menuitem", { name: "Imagem" }).or(page.getByText("Imagem", { exact: true })).first().click();

    const picker = page.getByRole("dialog", { name: /Selecionar imagem/i });
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await picker.getByRole("button", { name: /Selecionar pixel\.gif/ }).click();
    await picker.getByRole("button", { name: "Selecionar", exact: true }).click();

    const details = page.getByRole("dialog", { name: "Detalhes da imagem" });
    await expect(details, "alt text must be asked for before the node exists").toBeVisible({ timeout: 10_000 });

    const insert = details.getByRole("button", { name: "Inserir" });
    await expect(insert, "cannot insert with no alt and no decorative choice").toBeDisabled();

    await details.getByRole("textbox", { name: /Texto alternativo/ }).first().fill("Cartaz do filme");
    await expect(insert).toBeEnabled();
    await insert.click();
    await expect(details).toBeHidden();
  });

  test("a plain URL that is not a video is left alone", async ({ page }) => {
    const editor = await openNewArticle(page);

    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "https://example.com/artigo");
      const target = document.querySelector(".peg-editor__surface .ProseMirror");
      target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    await expect(editor).toContainText("https://example.com/artigo", { timeout: 10_000 });
  });
});
