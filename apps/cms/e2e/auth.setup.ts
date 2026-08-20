import { expect, test as setup } from "@playwright/test";

import { CREDENTIALS, STORAGE_STATE } from "./_surfaces";

/**
 * Logs in once for the whole run and saves the session.
 *
 * Every spec used to log in per test. `POST /v1/auth/login` is rate limited to 10 per
 * minute (deliberately - it is the brute-force control), and a full-suite run made ~13
 * login calls, so the last few were refused with 429 and the specs failed on an
 * unauthenticated redirect. Sharing one session removes the contention without weakening
 * the limit.
 */
setup("authenticate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(CREDENTIALS.email);
  await page.getByLabel("Senha", { exact: true }).fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/articles/, { timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
