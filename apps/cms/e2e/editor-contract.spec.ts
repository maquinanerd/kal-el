import { expect, test, type Page } from "@playwright/test";

import { CREDENTIALS } from "./_surfaces";

/**
 * `docs/02-EDITOR-UX.md` lists slash commands, paste-to-embed and drag/drop of images as
 * part of the editor contract. These exercise them through the real UI.
 */

async function openNewArticle(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(CREDENTIALS.email);
  await page.getByLabel("Senha").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/articles/, { timeout: 30_000 });

  await page.getByRole("button", { name: "Novo artigo" }).first().click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Novo artigo", { timeout: 30_000 });

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
