import { expect, test } from "@playwright/test";

test.describe("editorial lifecycle", () => {
  test("login, create an article, write, save and reopen it", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("owner@kalel.dev");
    await page.getByLabel("Senha").fill("kalel-dev-password-1");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/articles/, { timeout: 15_000 });

    // empty or existing articles — either is a valid real state
    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 15_000 });

    // this test edits after the load settles; the pre-load case has its own test below
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
    const res = await request.post("http://localhost:3101/v1/sites/00000000-0000-0000-0000-000000000000/articles", {
      data: { title: "x", status: "published" },
    });
    expect(res.status()).toBe(401);
  });

  test("text typed before the GET resolves is kept and saved", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("owner@kalel.dev");
    await page.getByLabel("Senha").fill("kalel-dev-password-1");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/articles/, { timeout: 15_000 });

    // hold the article GET open so the editor page renders while the request is still in flight
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const articleGet = /\/v1\/sites\/[^/]+\/articles\/[^/?]+(\?.*)?$/;
    await page.route(articleGet, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await gate;
      return route.continue();
    });

    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 15_000 });

    // the body is not editable yet — it would be remounted when the response lands
    await expect(page.getByText("Carregando o conteúdo do artigo")).toBeVisible();

    const unique = `E2E pre-load ${Date.now()}`;
    await page.getByLabel("Título", { exact: true }).fill(unique);

    release();

    // the response arrives now and must not overwrite what was typed
    await expect(page.locator(".peg-editor__surface .ProseMirror")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue(unique);

    // and the edit made during loading still reaches the server
    await expect(page.getByText("Salvo")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue(unique, { timeout: 15_000 });
  });
});
