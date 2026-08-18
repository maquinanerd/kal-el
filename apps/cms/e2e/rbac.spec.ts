import { expect, test, type APIRequestContext } from "@playwright/test";

import { CREDENTIALS } from "./_surfaces";

const API = "http://localhost:3101";

/**
 * The previous RBAC "proof" in editorial.spec.ts asserted that an *unauthenticated*
 * POST returns 401 - which says nothing about roles. This provisions a real author
 * (create user -> create role -> assign at the site) and checks what that author can and
 * cannot do, with the backend as the authority.
 */

type Ctx = { cookie: string; csrf: string };

async function login(request: APIRequestContext, email: string, password: string): Promise<Ctx> {
  const res = await request.post(`${API}/v1/auth/login`, { data: { email, password } });
  expect(res.status(), `login failed for ${email}`).toBe(200);
  // the session token and the CSRF token both come back as cookies; `ke_csrf` is
  // deliberately not httpOnly so the SPA can echo it back in the header
  const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie");
  const pairs = setCookie.map((h) => h.value.split(";")[0] ?? "");
  const cookie = pairs.join("; ");
  const csrfPair = pairs.find((p) => p.startsWith("ke_csrf="));
  const csrf = csrfPair ? decodeURIComponent(csrfPair.slice("ke_csrf=".length)) : "";
  expect(csrf, "login must set a CSRF cookie").not.toBe("");
  return { cookie, csrf };
}

const h = (c: Ctx) => ({ Cookie: c.cookie, "x-kal-el-csrf": c.csrf });

test.describe("RBAC (backend is the authority)", () => {
  test("an author can write but cannot publish, schedule or approve", async ({ request }) => {
    const owner = await login(request, CREDENTIALS.email, CREDENTIALS.password);

    const sites = await request.get(`${API}/v1/me/sites`, { headers: { Cookie: owner.cookie } });
    const siteId = (await sites.json()).data[0].id as string;

    const stamp = Date.now();
    const email = `autor-${stamp}@kalel.test`;
    const password = "autor-password-12345";

    const user = await request.post(`${API}/v1/admin/users`, {
      headers: h(owner),
      data: { email, name: "Autor E2E", password },
    });
    expect(user.status()).toBe(201);

    const role = await request.post(`${API}/v1/admin/roles`, {
      headers: h(owner),
      data: {
        key: `autor-e2e-${stamp}`,
        name: "Autor E2E",
        permissions: ["articles.create", "articles.read", "articles.update", "articles.submit"],
      },
    });
    expect(role.status()).toBe(201);

    const assigned = await request.post(`${API}/v1/admin/users/${(await user.json()).data.id}/roles`, {
      headers: h(owner),
      data: { roleId: (await role.json()).data.id, siteId },
    });
    expect(assigned.status()).toBe(201);

    const author = await login(request, email, password);

    // can create a draft
    const draft = await request.post(`${API}/v1/sites/${siteId}/articles`, {
      headers: h(author),
      data: { title: `Rascunho do autor ${stamp}` },
    });
    expect(draft.status(), "an author must be able to create a draft").toBe(201);
    const articleId = (await draft.json()).data.id as string;

    // cannot create straight into published or scheduled
    const published = await request.post(`${API}/v1/sites/${siteId}/articles`, {
      headers: h(author),
      data: { title: `Publicado direto ${stamp}`, status: "published" },
    });
    expect(published.status(), "creating as published needs articles.publish").toBe(403);

    const scheduled = await request.post(`${API}/v1/sites/${siteId}/articles`, {
      headers: h(author),
      data: { title: `Agendado direto ${stamp}`, status: "scheduled", scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(scheduled.status(), "creating as scheduled needs articles.schedule").toBe(403);

    // cannot publish, schedule or approve an existing article
    expect((await request.post(`${API}/v1/sites/${siteId}/articles/${articleId}/publish`, { headers: h(author) })).status()).toBe(403);
    expect((await request.post(`${API}/v1/sites/${siteId}/articles/${articleId}/approve`, { headers: h(author) })).status()).toBe(403);

    // can submit for review
    const submitted = await request.post(`${API}/v1/sites/${siteId}/articles/${articleId}/submit`, { headers: h(author) });
    expect(submitted.status(), "an author must be able to submit for review").toBe(200);
    expect((await submitted.json()).data.status).toBe("in_review");

    // and the owner can then approve and publish it
    expect((await request.post(`${API}/v1/sites/${siteId}/articles/${articleId}/approve`, { headers: h(owner) })).status()).toBe(200);
    const pub = await request.post(`${API}/v1/sites/${siteId}/articles/${articleId}/publish`, { headers: h(owner) });
    expect(pub.status()).toBe(200);
    expect((await pub.json()).data.status).toBe("published");
  });

  test("the UI cannot be used to bypass the backend: an author's session is rejected the same way", async ({ browser }) => {
    const owner = await login(await browser.newContext().then((c) => c.request), CREDENTIALS.email, CREDENTIALS.password);
    const sitesRes = await (await browser.newContext()).request.get(`${API}/v1/me/sites`, {
      headers: { Cookie: owner.cookie },
    });
    const siteId = (await sitesRes.json()).data[0].id as string;

    // a request carrying no CSRF token is refused even with a valid session cookie
    const context = await browser.newContext();
    const noCsrf = await context.request.post(`${API}/v1/sites/${siteId}/articles`, {
      headers: { Cookie: owner.cookie },
      data: { title: "sem csrf" },
    });
    expect(noCsrf.status()).toBe(403);
    await context.close();
  });
});
