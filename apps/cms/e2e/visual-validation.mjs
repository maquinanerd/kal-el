/**
 * Directed visual validation for the final PEG round.
 *
 * Not a test suite — a single sweep over the screens that changed, at the four viewports
 * and both themes, that (a) writes a screenshot per combination and (b) measures the
 * gates the Chrome product review defined, so "PASS" is a number rather than an opinion.
 *
 * Runs against an already-running local stack (CMS 3000 / API 3001), so it sees the real
 * seeded data rather than an empty e2e database.
 *
 *   node apps/cms/e2e/visual-validation.mjs [outDir]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CMS = process.env.CMS_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:3001";
const EMAIL = process.env.KALEL_EMAIL ?? "owner@kalel.dev";
const PASSWORD = process.env.KALEL_PASSWORD ?? "kalel-dev-password-1";
const OUT = process.argv[2] ?? join(process.cwd(), "artifacts", "visual");

const VIEWPORTS = [
  { id: "1440", width: 1440, height: 900 },
  { id: "1526", width: 1526, height: 900 },
  { id: "768", width: 768, height: 1024 },
  { id: "390", width: 390, height: 844 },
];

const SURFACES = [
  { id: "dashboard", path: "/" },
  { id: "articles", path: "/articles" },
  { id: "editor", path: "__EDITOR__" },
  { id: "media", path: "/media" },
  { id: "workflow", path: "/workflow" },
  { id: "calendar", path: "/calendar" },
  { id: "sites", path: "/sites" },
  { id: "users", path: "/users" },
  { id: "roles", path: "/roles" },
  { id: "audit", path: "/audit" },
  { id: "webhooks", path: "/webhooks" },
  { id: "settings", path: "/settings" },
  { id: "notfound", path: "/articles/00000000-0000-0000-0000-000000000000" },
];

/** Runs in the page: measures the gates that must hold on every screen. */
function measure() {
  function lin(v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function lum(rgb) {
    const m = (rgb || "").match(/\d+/g);
    if (!m) return null;
    return 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
  }
  function ratio(fg, bg) {
    const a = lum(fg);
    const b = lum(bg);
    if (a === null || b === null) return null;
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  }
  /** Walks up for the first non-transparent background — a button on a card inherits it. */
  function effectiveBg(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  }

  const content = document.querySelector(".peg-content");
  const app = document.querySelector(".peg-app");

  // every visible button must have a readable label against what is actually behind it
  const buttons = [...document.querySelectorAll(".peg-btn")].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && b.textContent.trim().length > 0;
  });
  const invisible = [];
  for (const b of buttons) {
    const cs = getComputedStyle(b);
    const bg = /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) ? effectiveBg(b.parentElement) : cs.backgroundColor;
    const r = ratio(cs.color, bg);
    if (r !== null && r < 3) {
      invisible.push({ label: b.textContent.trim().slice(0, 40), fg: cs.color, bg, ratio: r, disabled: b.disabled });
    }
  }

  // raw enum leaking into the interface
  const text = document.body.innerText;
  const rawEnums = ["in_review", "blocked", "scheduled", "archived", "draft", "published"].filter((e) =>
    new RegExp(`\\b${e}\\b`).test(text),
  );

  let scroll = null;
  if (content) {
    const before = content.scrollTop;
    content.scrollTop = 1e6;
    const reached = content.scrollTop;
    content.scrollTop = before;
    scroll = {
      client: content.clientHeight,
      scrollHeight: content.scrollHeight,
      overflows: content.scrollHeight > content.clientHeight + 1,
      maxScroll: reached,
      // if it overflows, scrolling must actually move it to the end
      reachesEnd: content.scrollHeight <= content.clientHeight + 1 || reached >= content.scrollHeight - content.clientHeight - 2,
    };
  }

  return {
    /**
     * Did the CMS shell actually render?
     *
     * Without this the sweep happily measured Next's error overlay and reported zero
     * defects on every screen - the most dangerous possible result, because it looks like
     * a pass. Every other number below is only meaningful when this is true.
     */
    shellRendered: !!app && !!content,
    frameHeight: app ? app.clientHeight : null,
    innerHeight: window.innerHeight,
    scroll,
    bodyScrolls: document.body.scrollHeight > window.innerHeight + 1,
    invisibleButtons: invisible,
    buttonCount: buttons.length,
    rawEnums,
    breadcrumb: document.querySelector(".peg-breadcrumb")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    hasSaveSlot: !!document.querySelector(".peg-topbar__status"),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];

  // one login, reused for the whole sweep
  const ctx0 = await browser.newContext({ baseURL: CMS });
  const api = await ctx0.request.post(`${API}/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (!api.ok()) throw new Error(`login failed: ${api.status()}`);
  const storage = await ctx0.storageState();
  await ctx0.close();

  // resolve a real article id for the editor surface
  const probe = await browser.newContext({ storageState: storage });
  const probePage = await probe.newPage();
  await probePage.goto(`${CMS}/articles`);
  await probePage.waitForTimeout(3000);
  const articleHref = await probePage.evaluate(async () => {
    const res = await fetch("http://localhost:3001/v1/me/sites", { credentials: "include" });
    const sites = (await res.json()).data;
    const r2 = await fetch(`http://localhost:3001/v1/sites/${sites[0].id}/articles?limit=1`, { credentials: "include" });
    const items = (await r2.json()).data.items;
    return items[0] ? `/articles/${items[0].id}` : null;
  });
  await probe.close();

  for (const theme of ["light", "dark"]) {
    for (const vp of VIEWPORTS) {
      // dark is only swept at the two desktop widths; the responsive work is theme-agnostic
      if (theme === "dark" && vp.id !== "1440" && vp.id !== "1526") continue;

      const context = await browser.newContext({
        storageState: storage,
        viewport: { width: vp.width, height: vp.height },
      });
      await context.addInitScript((t) => {
        try {
          localStorage.setItem("kal-el-theme", t);
        } catch {
          /* ignore */
        }
      }, theme);
      const page = await context.newPage();

      for (const surface of SURFACES) {
        const path = surface.path === "__EDITOR__" ? articleHref : surface.path;
        if (!path) continue;
        const name = `${surface.id}-${vp.id}-${theme}`;
        try {
          await page.goto(`${CMS}${path}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(2600);
          const m = await page.evaluate(measure);
          await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
          report.push({ surface: surface.id, viewport: vp.id, theme, ...m });
        } catch (err) {
          report.push({ surface: surface.id, viewport: vp.id, theme, error: String(err).slice(0, 200) });
        }
      }
      await context.close();
    }
  }

  await browser.close();
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // ---- summary ----
  const errors = report.filter((r) => r.error);
  const noShell = report.filter((r) => !r.error && !r.shellRendered);
  const measured = report.filter((r) => !r.error && r.shellRendered);
  const invisible = measured.filter((r) => (r.invisibleButtons ?? []).some((b) => !b.disabled));
  const unreachable = measured.filter((r) => r.scroll && !r.scroll.reachesEnd);
  const doubleScroll = measured.filter((r) => r.bodyScrolls);
  const enums = measured.filter((r) => (r.rawEnums ?? []).length > 0);

  console.log(`\ncaptured ${report.length} combinations -> ${OUT}`);
  console.log(`actually measured     : ${measured.length}`);
  console.log(`nav errors            : ${errors.length}`);
  console.log(`shell did NOT render  : ${noShell.length}`);
  console.log(`invisible CTAs        : ${invisible.length}`);
  console.log(`unreachable content   : ${unreachable.length}`);
  console.log(`double scrollbars     : ${doubleScroll.length}`);
  console.log(`raw enums in UI       : ${enums.length}`);
  for (const r of errors.slice(0, 5)) console.log(`  ERROR ${r.surface}/${r.viewport}/${r.theme}: ${r.error}`);
  for (const r of noShell.slice(0, 8)) console.log(`  NO SHELL ${r.surface}/${r.viewport}/${r.theme}`);
  for (const r of invisible.slice(0, 8)) {
    console.log(`  INVISIBLE ${r.surface}/${r.viewport}/${r.theme}:`, JSON.stringify(r.invisibleButtons.filter((b) => !b.disabled)));
  }
  for (const r of unreachable.slice(0, 8)) console.log(`  UNREACHABLE ${r.surface}/${r.viewport}/${r.theme}:`, JSON.stringify(r.scroll));
  for (const r of enums.slice(0, 8)) console.log(`  ENUM ${r.surface}/${r.viewport}/${r.theme}:`, r.rawEnums.join(","));

  // A sweep whose subject never rendered must not read as a pass.
  if (measured.length === 0 || noShell.length > 0 || errors.length > 0) {
    console.log("\nSWEEP INCONCLUSIVE — the numbers above do not describe the product.");
    process.exitCode = 1;
  } else {
    console.log("\nSWEEP OK");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
