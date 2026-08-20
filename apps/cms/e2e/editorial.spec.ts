import { expect, test } from "@playwright/test";

test.describe("editorial lifecycle", () => {
  test("login, create an article, write, save and reopen it", async ({ page }) => {
    await page.goto("/login");
    // exact: a tela tem "Lembrar meu e-mail" e o botao "Mostrar senha", que casam por substring
    await page.getByLabel("E-mail", { exact: true }).fill("owner@kalel.dev");
    await page.getByLabel("Senha", { exact: true }).fill("kalel-dev-password-1");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/articles/, { timeout: 15_000 });

    // empty or existing articles — either is a valid real state
    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 15_000 });

    // wait for the article to finish loading before editing (avoid overwriting user input)
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Novo artigo", { timeout: 15_000 });

    const unique = `E2E ${Date.now()}`;
    await page.getByLabel("Título", { exact: true }).fill(unique);

    // write into the editor (ProseMirror contenteditable)
    const editor = page.locator(".peg-editor__surface .ProseMirror");
    await editor.click();
    await page.keyboard.type("Texto real escrito pelo E2E.");

    // wait for autosave
    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 15_000 });

    // reload and confirm persistence
    await page.reload();
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue(unique, { timeout: 15_000 });
    await expect(editor).toContainText("Texto real escrito pelo E2E.");
  });

  test("an author cannot publish without permission (API authority)", async ({ request }) => {
    // the backend enforces RBAC even if the UI hides nothing; a draft POST with status=published
    // must be rejected for a user without articles.publish. Verify via the API directly.
    // 127.0.0.1, nao localhost: a API sobe com HOST=127.0.0.1 e em maquina com IPv6
    // primeiro o "localhost" resolve para ::1 e a conexao e recusada.
    const res = await request.post("http://127.0.0.1:3101/v1/sites/00000000-0000-0000-0000-000000000000/articles", {
      data: { title: "x", status: "published" },
    });
    expect(res.status()).toBe(401);
  });
});
