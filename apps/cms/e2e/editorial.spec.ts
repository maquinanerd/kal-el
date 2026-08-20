import { expect, test } from "@playwright/test";

import { createArticle } from "./_seed";

test.describe("editorial lifecycle", () => {
  test("login, create an article, write, save and reopen it", async ({ page }) => {
    // creates the article and waits for it to finish loading, so the first keystroke is
    // not overwritten by the load effect
    await createArticle(page);

    const unique = `E2E ${Date.now()}`;
    await page.getByLabel("Título do artigo").fill(unique);

    // write into the editor (ProseMirror contenteditable)
    const editor = page.locator(".peg-editor__surface .ProseMirror");
    await editor.click();
    await page.keyboard.type("Texto real escrito pelo E2E.");

    // Wait for the autosave PATCH the server actually accepted, not for the transient
    // "Salvo" label. Under load the label can settle from an earlier debounce cycle,
    // which made this reload before the write landed.
    const saved = await page.waitForResponse(
      (r) => r.request().method() === "PATCH" && /\/articles\//.test(r.url()) && r.status() < 300,
      { timeout: 20_000 },
    );
    expect((await saved.json()).data.title, "the accepted write must carry the new title").toBe(unique);
    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 15_000 });

    // reload and confirm persistence
    await page.reload();
    await expect(page.getByLabel("Título do artigo")).toHaveValue(unique, { timeout: 15_000 });
    await expect(editor).toContainText("Texto real escrito pelo E2E.");
  });

  // no storageState: the whole point is that the caller has no session. With the shared
  // session applied this returned 403 (CSRF) instead of 401, which is a different control.
  test("keeps text typed the moment the article opens, even on a slow load", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("owner@kalel.dev");
    await page.getByLabel("Senha").fill("kalel-dev-password-1");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/articles/, { timeout: 15_000 });

    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 15_000 });
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Novo artigo", { timeout: 15_000 });

    // Hold the article back so the editor is unmistakably still loading while we type.
    await page.route("**/v1/sites/*/articles/*", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return route.continue();
    });

    await page.reload();

    // Editing has to wait for the real document: an editor shown before the response
    // holds an empty doc that is not the article, and the response would overwrite it.
    const editor = page.locator(".peg-editor__surface .ProseMirror");
    await editor.click({ timeout: 15_000 });
    await page.keyboard.type("Escrito assim que o artigo abriu.");

    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 15_000 });
    await page.unroute("**/v1/sites/*/articles/*");
    await page.reload();
    await expect(editor).toContainText("Escrito assim que o artigo abriu.", { timeout: 15_000 });
  });

  test.describe("without a session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    // Narrow by design: this only proves the auth gate. Real role enforcement - what an
    // author can and cannot do once logged in - is covered in rbac.spec.ts, which
    // provisions an actual author. (This test used to be labelled as the RBAC proof.)
    test("an unauthenticated write is rejected", async ({ request }) => {
      const res = await request.post("http://localhost:3101/v1/sites/00000000-0000-0000-0000-000000000000/articles", {
        data: { title: "x", status: "published" },
      });
      expect(res.status()).toBe(401);
    });
  });
});
