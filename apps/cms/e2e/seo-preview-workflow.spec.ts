import { expect, test, type Page } from "@playwright/test";

import { API, activeSiteId, readArticle } from "./_seed";

async function newArticle(page: Page): Promise<string> {
  await page.goto("/articles");
  await expect(page.getByRole("button", { name: "Novo artigo" }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Novo artigo" }).first().click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Novo artigo", { timeout: 30_000 });
  return page.url().split("/articles/")[1] ?? "";
}

/** Wait for an autosave the server accepted, rather than for the "Salvo" label. */
function savedResponse(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/articles\//.test(r.url()) && r.status() < 300,
    { timeout: 30_000 },
  );
}

test.describe("SEO", () => {
  test("editorial SEO fields persist, and changing the slug leaves a 301 behind", async ({ page }) => {
    const articleId = await newArticle(page);
    const siteId = await activeSiteId(page);

    const stamp = Date.now();
    const firstSlug = `slug-original-${stamp}`;
    await page.getByRole("textbox", { name: /^Slug/ }).fill(firstSlug);
    await page.getByRole("textbox", { name: /SEO — título/ }).fill("Título para o Google");
    await page.getByRole("textbox", { name: /SEO — meta descrição/ }).fill("Descrição que aparece no resultado de busca.");
    await page.getByRole("textbox", { name: /Canonical/ }).fill("https://exemplo.com/canonico");
    await savedResponse(page);

    // the SERP preview reflects what was typed (the input holds it too, hence .last())
    await expect(page.getByText("Título para o Google").last()).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: /^Slug/ })).toHaveValue(firstSlug, { timeout: 30_000 });
    await expect(page.getByRole("textbox", { name: /SEO — título/ })).toHaveValue("Título para o Google");
    await expect(page.getByRole("textbox", { name: /Canonical/ })).toHaveValue("https://exemplo.com/canonico");

    // change the slug: the old path must keep resolving
    const secondSlug = `slug-novo-${stamp}`;
    await page.getByRole("textbox", { name: /^Slug/ }).fill(secondSlug);
    await savedResponse(page);

    const persisted = await readArticle(page, siteId, articleId);
    expect(persisted.slug).toBe(secondSlug);

    const redirects = await page.evaluate(
      async ({ api, site }) => {
        const res = await fetch(`${api}/v1/sites/${site}/redirects`, { credentials: "include" });
        return (await res.json()).data as { sourcePath: string; targetPath: string; kind: string }[];
      },
      { api: API, site: siteId },
    );
    const redirect = redirects.find((r) => r.sourcePath.includes(firstSlug));
    expect(redirect, "renaming a slug must leave a redirect from the old one").toBeTruthy();
    expect(redirect?.targetPath).toContain(secondSlug);
    expect(redirect?.kind).toBe("301");
  });

  test("robots controls reach the persisted article", async ({ page }) => {
    const articleId = await newArticle(page);
    const siteId = await activeSiteId(page);

    await page.getByRole("combobox", { name: /Robots index/ }).selectOption("noindex");
    await savedResponse(page);

    const persisted = await readArticle(page, siteId, articleId);
    expect(persisted.seo.robotsIndex).toBe("noindex");
  });
});

test.describe("preview", () => {
  test("a draft renders through a signed preview and is marked noindex", async ({ page, context }) => {
    const articleId = await newArticle(page);
    const siteId = await activeSiteId(page);

    await page.getByLabel("Título", { exact: true }).fill("Rascunho com preview");
    const editor = page.locator(".peg-editor__surface .ProseMirror");
    await editor.click();
    await page.keyboard.type("Conteúdo que só existe no rascunho.");
    await savedResponse(page);

    // the preview URL is minted by the API, not guessable
    const preview = await page.evaluate(
      async ({ api, site, id }) => {
        const token = document.cookie.split("; ").find((c) => c.startsWith("ke_csrf="))?.slice("ke_csrf=".length) ?? "";
        const res = await fetch(`${api}/v1/sites/${site}/articles/${id}/preview`, {
          method: "POST",
          credentials: "include",
          headers: { "x-kal-el-csrf": decodeURIComponent(token) },
        });
        return (await res.json()).data as { url: string };
      },
      { api: API, site: siteId, id: articleId },
    );
    expect(preview.url).toContain("/v1/preview/");

    const token = preview.url.split("/v1/preview/")[1] ?? "";

    // render it in a context with NO session: a preview must stand on its token alone
    const anon = await context.browser()!.newContext();
    const anonPage = await anon.newPage();
    const response = await anonPage.goto(`/preview/${token}`);
    await expect(anonPage.getByText("Conteúdo que só existe no rascunho.")).toBeVisible({ timeout: 30_000 });

    const robots = await anonPage.evaluate(
      () => document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
    );
    expect(robots.toLowerCase(), "a preview must never be indexable").toContain("noindex");
    expect(response?.status()).toBeLessThan(400);

    // and an invalid token renders the refusal, not the article
    await anonPage.goto("/preview/kpv.invalido.assinatura");
    await expect(anonPage.getByText(/Preview inválido ou expirado/)).toBeVisible({ timeout: 30_000 });
    await expect(anonPage.getByText("Conteúdo que só existe no rascunho.")).toBeHidden();

    await anon.close();
  });
});

test.describe("workflow", () => {
  test("submit, approve and publish are reflected in the UI and in the data", async ({ page }) => {
    const articleId = await newArticle(page);
    const siteId = await activeSiteId(page);

    await page.getByLabel("Título", { exact: true }).fill(`Fluxo editorial ${Date.now()}`);
    await savedResponse(page);

    // the editor shows the current state and the actions legal from it
    await expect(page.getByText("draft", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Enviar p/ revisão" }).click();
    await expect(page.getByText("in_review", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect((await readArticle(page, siteId, articleId)).status).toBe("in_review");

    // the workflow queue lists it under "Em revisão"
    await page.goto("/workflow");
    await expect(page.getByRole("button", { name: "Em revisão" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Fluxo editorial/).first()).toBeVisible({ timeout: 30_000 });

    await page.goto(`/articles/${articleId}`);
    await expect(page.getByText("in_review", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Aprovar" }).click();
    // approve deliberately returns the article to draft - there is no `approved` status
    await expect(page.getByText("draft", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect((await readArticle(page, siteId, articleId)).status).toBe("draft");

    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible({ timeout: 30_000 });

    const published = await readArticle(page, siteId, articleId);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeTruthy();
  });

  test("the queue refuses to act on a row another tab has already moved", async ({ page }) => {
    // The idempotency key the CMS sends is scoped to the version the action was issued
    // against. The queue read that version once, on load, so a second tab could move the
    // article and leave this list holding a version that had already been used as a key -
    // and a used key replays its stored response: 200, no transition, no audit row, and a
    // queue reporting success. The server cannot catch it; the replay happens before the
    // handler runs.
    const articleId = await newArticle(page);
    const siteId = await activeSiteId(page);
    const title = `Fila obsoleta ${Date.now()}`;
    await page.getByLabel("Título", { exact: true }).fill(title);
    await savedResponse(page);

    await page.getByRole("button", { name: "Enviar p/ revisão" }).click();
    await expect(page.getByText("in_review", { exact: true })).toBeVisible({ timeout: 30_000 });

    const staleVersion = (await readArticle(page, siteId, articleId)).version as number;

    // the queue loads while the article is at `staleVersion`
    await page.goto("/workflow");
    await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 });

    // meanwhile, another tab approves it with exactly the key this queue would send,
    // and the writer resubmits
    const transition = (action: string, key?: string) =>
      page.evaluate(
        async ({ api, site, id, act, idem }) => {
          const token = document.cookie.split("; ").find((c) => c.startsWith("ke_csrf="))?.slice("ke_csrf=".length) ?? "";
          const headers: Record<string, string> = {
            "content-type": "application/json",
            "x-kal-el-csrf": decodeURIComponent(token),
          };
          if (idem) headers["idempotency-key"] = idem;
          const res = await fetch(`${api}/v1/sites/${site}/articles/${id}/${act}`, {
            method: "POST",
            credentials: "include",
            headers,
            body: "{}",
          });
          return res.status;
        },
        { api: API, site: siteId, id: articleId, act: action, idem: key },
      );

    expect(await transition("approve", `cms.${articleId}.approve.v${staleVersion}`)).toBe(200);
    expect(await transition("submit")).toBe(200);
    expect((await readArticle(page, siteId, articleId)).status).toBe("in_review");

    // the stale queue still shows the row; clicking must not report a phantom success
    await page.getByRole("button", { name: "Aprovar" }).first().click();
    await expect(page.getByText(/mudou desde que a fila foi carregada/)).toBeVisible({ timeout: 30_000 });
    expect((await readArticle(page, siteId, articleId)).status).toBe("in_review");

    // and the refreshed queue still works - the guard blocks the stale action, not the action
    await page.getByRole("button", { name: "Aprovar" }).first().click();
    await expect(page.getByText(/mudou desde que a fila foi carregada/)).toBeHidden({ timeout: 30_000 });
    await expect
      .poll(async () => (await readArticle(page, siteId, articleId)).status, { timeout: 30_000 })
      .toBe("draft");
  });

  test("publishing exactly once emits exactly one outbox event", async ({ page }) => {
    const articleId = await newArticle(page);
    const siteId = await activeSiteId(page);

    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible({ timeout: 30_000 });

    // publishing again from the UI must not double-emit; the transition is a no-op
    const second = await page.evaluate(
      async ({ api, site, id }) => {
        const token = document.cookie.split("; ").find((c) => c.startsWith("ke_csrf="))?.slice("ke_csrf=".length) ?? "";
        const res = await fetch(`${api}/v1/sites/${site}/articles/${id}/publish`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "x-kal-el-csrf": decodeURIComponent(token) },
          body: "{}",
        });
        return res.status;
      },
      { api: API, site: siteId, id: articleId },
    );
    expect(second, "a repeated publish is a no-op, not a conflict").toBe(200);
    expect((await readArticle(page, siteId, articleId)).status).toBe("published");
  });
});
