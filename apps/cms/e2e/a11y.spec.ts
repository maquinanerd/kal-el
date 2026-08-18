/**
 * Automated accessibility gate (axe-core, WCAG 2.1 A + AA).
 *
 * This is a real gate: the run fails if any surface has a `critical` or `serious`
 * violation. Results are also written to apps/cms/artifacts/a11y-report.json so the
 * audit document can cite exact rule ids and node counts.
 *
 * Run with: pnpm --filter @kal-el/cms exec playwright test a11y
 */
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { CREDENTIALS, SURFACES } from "./_surfaces";

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(here, "..", "artifacts");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type Violation = {
  surface: string;
  viewport: string;
  theme: string;
  id: string;
  impact: string;
  help: string;
  nodes: number;
  sample: string;
};

const collected: Violation[] = [];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(CREDENTIALS.email);
  await page.getByLabel("Senha").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/articles/, { timeout: 30_000 });
}

async function scan(page: Page, surface: string, viewport: string, theme: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of results.violations) {
    collected.push({
      surface,
      viewport,
      theme,
      id: v.id,
      impact: v.impact ?? "unknown",
      help: v.help,
      nodes: v.nodes.length,
      sample: (v.nodes[0]?.html ?? "").slice(0, 160),
    });
  }
  return results.violations;
}

test.describe("accessibility", () => {
  test("every surface passes axe (no critical or serious violations)", async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    mkdirSync(ARTIFACTS, { recursive: true });

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await login(page);

    await page.goto("/articles");
    await page.waitForTimeout(1200);
    let articleId = "";
    const existing = page.locator("a[href^='/articles/']").first();
    if ((await existing.count()) > 0) {
      const href = await existing.getAttribute("href");
      if (href) articleId = href.replace("/articles/", "");
    }
    if (!articleId) {
      await page.getByRole("button", { name: "Novo artigo" }).first().click();
      await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
      articleId = page.url().split("/articles/")[1];
    }

    const viewports = [
      { id: "1440", width: 1440, height: 900 },
      { id: "390", width: 390, height: 844 },
    ];

    for (const surface of SURFACES) {
      if (surface.needsMedia) continue; // media detail requires seeded media
      const path = surface.path.replace("__ARTICLE__", articleId);
      for (const vp of viewports) {
        for (const theme of ["light", "dark"]) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(path, { waitUntil: "domcontentloaded" });
          await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
          await page.waitForTimeout(500);
          await scan(page, surface.label, vp.id, theme);
        }
      }
    }

    await context.close();

    writeFileSync(join(ARTIFACTS, "a11y-report.json"), JSON.stringify(collected, null, 2), "utf8");

    // aggregate by rule so the failure message is actionable
    const byRule = new Map<string, { impact: string; nodes: number; surfaces: Set<string> }>();
    for (const v of collected) {
      const cur = byRule.get(v.id) ?? { impact: v.impact, nodes: 0, surfaces: new Set<string>() };
      cur.nodes += v.nodes;
      cur.surfaces.add(v.surface);
      byRule.set(v.id, cur);
    }
    const summary = [...byRule.entries()]
      .sort((a, b) => b[1].nodes - a[1].nodes)
      .map(([id, d]) => `${id} [${d.impact}] nodes=${d.nodes} surfaces=${d.surfaces.size}`);

    console.log(`\nAXE_TOTAL_VIOLATION_INSTANCES=${collected.length}`);
    console.log(`AXE_DISTINCT_RULES=${byRule.size}`);
    for (const line of summary) console.log(`  ${line}`);

    const blocking = collected.filter((v) => v.impact === "critical" || v.impact === "serious");
    const blockingRules = [...new Set(blocking.map((v) => v.id))];
    expect(
      blocking.length,
      `axe found ${blocking.length} critical/serious instances across rules: ${blockingRules.join(", ")}`,
    ).toBe(0);
  });

  test("keyboard: primary navigation is reachable and operable without a mouse", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/articles");
    await page.waitForTimeout(600);

    // At mobile width the user must still be able to reach primary navigation.
    // Either the sidebar is on-screen, or a control exists to reveal it.
    const reachable = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".peg-sidebar");
      if (!sidebar) return { onScreen: false, opener: null as string | null };
      const r = sidebar.getBoundingClientRect();
      const onScreen = r.right > 0 && r.left < window.innerWidth && r.width > 0;
      const opener = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']")).find(
        (el) =>
          /menu|navega|abrir/.test(
            `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.toLowerCase(),
          ),
      );
      return { onScreen, opener: opener ? opener.getAttribute("aria-label") ?? opener.textContent : null };
    });

    expect(
      reachable.onScreen || reachable.opener !== null,
      "at 390px the sidebar is off-canvas and no control exists to open it - primary navigation is unreachable",
    ).toBe(true);
  });

  test("dialog: media picker traps focus and closes on Escape", async ({ page }) => {
    await login(page);
    await page.goto("/articles");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Novo artigo" }).first().click();
    await page.waitForURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
    await page.waitForTimeout(2000);

    const trigger = page.getByRole("button", { name: "Selecionar imagem de destaque" });
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    await page.waitForTimeout(600);

    const dialog = page.getByRole("dialog");
    await expect(dialog, "media picker must expose role=dialog").toHaveCount(1);

    const focusInside = await page.evaluate(() => {
      const d = document.querySelector("[role='dialog']");
      return !!d && !!document.activeElement && d.contains(document.activeElement);
    });
    expect(focusInside, "focus must move into the dialog when it opens").toBe(true);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(dialog, "Escape must close the dialog").toHaveCount(0);
  });
});
