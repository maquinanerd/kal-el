/**
 * Diagnostic responsive/visual audit. This is NOT a pass/fail gate - it collects
 * mechanical evidence (overflow, unreachable navigation, undersized touch targets)
 * for every surface at every PEG breakpoint in both themes, plus screenshots.
 *
 * Run with:  pnpm --filter @kal-el/cms exec playwright test audit-responsive
 * Output:    apps/cms/artifacts/responsive-audit.json  +  apps/cms/artifacts/shots/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { BREAKPOINTS, STORAGE_STATE, SURFACES, THEMES } from "./_surfaces";

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(here, "..", "artifacts");
const SHOTS = join(ARTIFACTS, "shots");

type Offender = { tag: string; cls: string; right: number; width: number; text: string };
type SmallTarget = { tag: string; label: string; w: number; h: number };

type Measurement = {
  surface: string;
  path: string;
  breakpoint: string;
  width: number;
  theme: string;
  ok: boolean;
  horizontalOverflow: number;
  offenders: Offender[];
  navReachable: boolean;
  navOpener: string | null;
  smallTargets: SmallTarget[];
  smallTargetCount: number;
  consoleErrors: string[];
  shot: string;
};

async function measure(page: Page, viewportWidth: number) {
  return page.evaluate((vw) => {
    const doc = document.documentElement;
    const overflow = Math.max(0, doc.scrollWidth - vw);

    const offenders: {
      tag: string;
      cls: string;
      right: number;
      width: number;
      text: string;
    }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // ignore intentionally off-canvas drawers
      if (style.position === "fixed" && r.right <= 0) continue;
      if (r.right > vw + 2) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 90),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: String(el.textContent || "").trim().slice(0, 45),
        });
      }
      if (offenders.length >= 12) break;
    }

    // Is primary navigation actually reachable at this width?
    const sidebar = document.querySelector<HTMLElement>(".peg-sidebar");
    let navReachable = false;
    if (sidebar) {
      const r = sidebar.getBoundingClientRect();
      const s = getComputedStyle(sidebar);
      navReachable =
        r.width > 0 &&
        r.height > 0 &&
        r.right > 0 &&
        r.left < vw &&
        s.visibility !== "hidden" &&
        s.display !== "none";
    }

    // Is there any control that could open navigation (hamburger)?
    const openerCandidates = Array.from(
      document.querySelectorAll<HTMLElement>("button, [role='button'], a"),
    ).filter((el) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || el.offsetParent === null) return false;
      const name = [
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.textContent || "",
      ]
        .join(" ")
        .toLowerCase();
      return /abrir navega|menu|hamb/.test(name);
    });
    const navOpener =
      openerCandidates.length > 0
        ? String(
            openerCandidates[0].getAttribute("aria-label") || openerCandidates[0].textContent || "",
          )
            .trim()
            .slice(0, 40)
        : null;

    // Interactive controls smaller than the 44x44 touch-target guidance
    const smallTargets: { tag: string; label: string; w: number; h: number }[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a[href], input:not([type=hidden]), select, textarea, [role='button']",
      ),
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") continue;
      if (r.width < 44 || r.height < 44) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          label: String(el.getAttribute("aria-label") || el.textContent || "")
            .trim()
            .slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }

    return { overflow, offenders, navReachable, navOpener, smallTargets };
  }, viewportWidth);
}

test("collect responsive/visual evidence for every surface", async ({ browser }) => {
  test.setTimeout(25 * 60_000);
  mkdirSync(SHOTS, { recursive: true });

  const results: Measurement[] = [];

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: STORAGE_STATE,
  });
  const page = await context.newPage();

  // make sure there is an article to open the editor on
  await page.goto("/articles");
  await page.waitForTimeout(1500);
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

  // find a media id if one exists (media detail is optional evidence)
  await page.goto("/media");
  await page.waitForTimeout(1500);
  let mediaId = "";
  const mediaLink = page.locator("a[href^='/media/']").first();
  if ((await mediaLink.count()) > 0) {
    const href = await mediaLink.getAttribute("href");
    if (href) mediaId = href.replace("/media/", "");
  }

  for (const surface of SURFACES) {
    if (surface.needsArticle && !articleId) continue;
    if (surface.needsMedia && !mediaId) continue;
    const path = surface.path.replace("__ARTICLE__", articleId).replace("__MEDIA__", mediaId);

    for (const bp of BREAKPOINTS) {
      for (const theme of THEMES) {
        const consoleErrors: string[] = [];
        const onErr = (m: { type: () => string; text: () => string }) => {
          if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
        };
        page.on("console", onErr);

        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(path, { waitUntil: "domcontentloaded" });
        // force the theme token layer regardless of whether the app can switch it
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        // the shell is client-rendered: measuring before it mounts yields phantom failures
        if (surface.id !== "login") {
          await page.waitForSelector(".peg-topbar", { state: "attached", timeout: 20_000 }).catch(() => {});
        }
        await page.waitForTimeout(600);

        const m = await measure(page, bp.width);
        const shot = `${surface.id}__${bp.id}__${theme}.png`;
        await page.screenshot({ path: join(SHOTS, shot), fullPage: false });

        page.off("console", onErr);

        results.push({
          surface: surface.label,
          path,
          breakpoint: bp.id,
          width: bp.width,
          theme,
          // navigation counts as accessible if the sidebar is on-screen OR a control exists to reveal it
          ok: m.overflow === 0 && (m.navReachable || m.navOpener !== null),
          horizontalOverflow: m.overflow,
          offenders: m.offenders,
          navReachable: m.navReachable,
          navOpener: m.navOpener,
          smallTargets: m.smallTargets.slice(0, 8),
          smallTargetCount: m.smallTargets.length,
          consoleErrors,
          shot,
        });
      }
    }
  }

  await context.close();

  writeFileSync(join(ARTIFACTS, "responsive-audit.json"), JSON.stringify(results, null, 2), "utf8");

  const overflowing = results.filter((r) => r.horizontalOverflow > 0);
  const navBroken = results.filter(
    (r) => !r.navReachable && r.navOpener === null && r.surface !== "Login",
  );
  const byWidth: Record<string, number> = {};
  for (const r of navBroken) byWidth[r.breakpoint] = (byWidth[r.breakpoint] ?? 0) + 1;
  const overflowByWidth: Record<string, number> = {};
  for (const r of overflowing) overflowByWidth[r.breakpoint] = (overflowByWidth[r.breakpoint] ?? 0) + 1;

  console.log(`\nSURFACES=${SURFACES.length} MEASUREMENTS=${results.length}`);
  console.log(`HORIZONTAL_OVERFLOW=${overflowing.length} BY_WIDTH=${JSON.stringify(overflowByWidth)}`);
  console.log(`NAV_UNREACHABLE=${navBroken.length} BY_WIDTH=${JSON.stringify(byWidth)}`);
  console.log(`NAV_OPENER_PRESENT=${results.some((r) => r.navOpener !== null)}`);
  console.log(
    `MAX_SMALL_TARGETS_ON_A_SURFACE=${Math.max(...results.map((r) => r.smallTargetCount))}`,
  );
});
