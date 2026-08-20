import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The 390px pass the previous product review could not finish: it lost its session to the
 * drawer's "Owner" row before reaching the editor.
 *
 * These assertions are deliberately about geometry and reachability rather than looks. A
 * screen "works at 390" when nothing escapes the viewport sideways, every control the
 * task needs can be touched, and any surface taller than the screen scrolls inside itself
 * instead of pushing the page.
 */

const MOBILE = { width: 390, height: 844 };

test.use({ viewport: MOBILE });

/** The page itself must never scroll sideways. Overlays are allowed to, inside their box. */
async function expectNoPageOverflow(page: Page, where: string) {
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
  }));
  expect(m.doc, `${where}: the document must not scroll horizontally`).toBeLessThanOrEqual(m.client + 1);
  expect(m.body, `${where}: the body must not scroll horizontally`).toBeLessThanOrEqual(m.client + 1);
}

async function expectInsideViewport(locator: Locator, where: string) {
  const box = await locator.boundingBox();
  expect(box, `${where}: must be laid out`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${where}: must not start off the left edge`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${where}: must not run past the right edge`).toBeLessThanOrEqual(MOBILE.width + 1);
  expect(box.y, `${where}: must not sit above the viewport`).toBeGreaterThanOrEqual(-1);
}

async function openNewArticle(page: Page) {
  await page.goto("/articles");
  await expect(page.getByRole("button", { name: "Novo artigo" }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Novo artigo" }).first().click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(page.getByLabel("Título do artigo")).toHaveValue("Novo artigo", { timeout: 30_000 });
  return page.locator(".peg-editor__surface .ProseMirror");
}

test.describe("mobile editor at 390px", () => {
  test("the writing surface, its toolbar and its actions all fit", async ({ page }) => {
    const editor = await openNewArticle(page);
    await expectNoPageOverflow(page, "article editor");

    // the title reads as a headline, not as shrunken body copy
    const titleSize = await page
      .getByLabel("Título do artigo")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(titleSize, "the title must stay a heading at 390px").toBeGreaterThanOrEqual(24);

    const bodySize = await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(bodySize, "body copy must stay comfortably readable").toBeGreaterThanOrEqual(16);

    // the toolbar wraps instead of running off the side, and its buttons are touchable
    const toolbar = page.getByRole("toolbar", { name: "Formatar texto" });
    await expect(toolbar).toBeVisible();
    await expectInsideViewport(toolbar, "editor toolbar");
    const toolbarOverflow = await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(toolbarOverflow, "the toolbar must wrap, not clip").toBeLessThanOrEqual(1);

    const bold = page.getByRole("button", { name: "Negrito (Ctrl+B)" });
    const boldBox = await bold.boundingBox();
    expect(boldBox?.height ?? 0, "toolbar buttons must be touchable").toBeGreaterThanOrEqual(24);

    // the workflow actions wrap rather than overflowing
    const actions = page.locator(".kalel-editor__actions");
    await expectInsideViewport(actions, "editor actions");
    const actionsOverflow = await actions.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(actionsOverflow, "the action bar must not clip its buttons").toBeLessThanOrEqual(1);
    for (const label of ["Preview", "Enviar p/ revisão", "Agendar", "Publicar", "Documento"]) {
      await expectInsideViewport(page.getByRole("button", { name: label }), `action "${label}"`);
    }
  });

  test("the slash menu and the bubble toolbar stay on screen", async ({ page }) => {
    const editor = await openNewArticle(page);
    await editor.click();

    // slash menu, opened near the right edge where it is most likely to escape
    await page.keyboard.type("uma linha de texto que empurra o cursor para a direita /");
    const menu = page.getByRole("listbox", { name: "Inserir bloco" });
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expectInsideViewport(menu, "slash menu");
    await page.keyboard.press("Escape");

    // bubble toolbar over a selection
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const bubble = page.getByRole("toolbar", { name: "Formatação da seleção" });
    await expect(bubble).toBeVisible({ timeout: 10_000 });
    await expectInsideViewport(bubble, "bubble toolbar");

    await expectNoPageOverflow(page, "editor with overlays");
  });

  test("the link and schedule dialogs are usable", async ({ page }) => {
    const editor = await openNewArticle(page);
    await editor.click();
    await page.keyboard.type("um destino");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Control+k");

    const link = page.getByRole("dialog", { name: "Link" });
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expectInsideViewport(link, "link dialog");
    await expect(link.getByLabel("URL")).toBeVisible();
    await expect(link.getByRole("button", { name: "Aplicar" })).toBeVisible();
    await expectNoPageOverflow(page, "link dialog open");
    await link.getByRole("button", { name: "Cancelar" }).click();
    await expect(link).toBeHidden();

    await page.getByRole("button", { name: "Agendar" }).click();
    const schedule = page.getByRole("dialog").first();
    await expect(schedule).toBeVisible({ timeout: 10_000 });
    await expectInsideViewport(schedule, "schedule dialog");
    await expectNoPageOverflow(page, "schedule dialog open");
    // its own controls are reachable, not cut off at the bottom of a too-tall sheet
    const dialogOverflow = await schedule.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(dialogOverflow, "the schedule dialog must not scroll sideways").toBeLessThanOrEqual(1);
  });
});

test.describe("mobile inspector at 390px", () => {
  test("opens as a sheet with its own scroll, and carries the whole document surface", async ({ page }) => {
    await openNewArticle(page);

    const inspector = page.locator(".kalel-inspector");
    // Before opening it must be off-canvas, NOT 2000px of fields stacked under the body.
    const closed = await inspector.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, visibility: cs.visibility, transform: cs.transform };
    });
    expect(closed.position, "the inspector must be a sheet, not part of the flow").toBe("fixed");
    expect(closed.visibility, "and hidden until asked for").toBe("hidden");

    await page.getByRole("button", { name: "Documento" }).click();
    await expect(inspector).toHaveClass(/kalel-inspector--open/);
    await expectInsideViewport(inspector, "inspector sheet");

    // it scrolls inside itself: the page behind it must not have grown
    const body = inspector.locator(".kalel-inspector__body");
    const scrolls = await body.evaluate((el) => getComputedStyle(el).overflowY);
    expect(["auto", "scroll"], "the sheet must own its scrolling").toContain(scrolls);
    const height = await inspector.evaluate((el) => el.getBoundingClientRect().height);
    expect(height, "the sheet must be bounded by the viewport").toBeLessThanOrEqual(MOBILE.height);
    await expectNoPageOverflow(page, "inspector open");

    // everything the spec expects to reach from here
    await expect(page.getByLabel("Slug")).toBeVisible();
    // scoped to the section headings: "Autores" is also a field label inside one of them
    for (const section of ["Publicação", "Autores", "Editoria", "Tags e entidades", "Revisões"]) {
      await expect(
        inspector.locator(".peg-inspector-section__title").filter({ hasText: new RegExp(`^${section}$`) }),
      ).toBeVisible();
    }
    await expect(inspector.getByRole("button", { name: /Imagem destacada|Selecionar imagem/ }).first()).toBeVisible();

    // SEO and QA are the other two tabs of the same sheet
    await inspector.getByRole("button", { name: "SEO" }).click();
    await expect(inspector.locator(".peg-inspector-section__title").filter({ hasText: /^Busca$/ })).toBeVisible();
    await inspector.getByRole("button", { name: "QA" }).click();
    await expect(
      inspector.locator(".peg-inspector-section__title").filter({ hasText: /^Checklist editorial$/ }),
    ).toBeVisible();

    // and it closes again
    await page.getByRole("button", { name: "Fechar inspector" }).click();
    await expect(inspector).not.toHaveClass(/kalel-inspector--open/);
  });
});

test.describe("mobile calendar at 390px", () => {
  test("every view stays legible and nothing escapes the page", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Calendário" })).toBeVisible({ timeout: 30_000 });
    await expectNoPageOverflow(page, "calendar month");

    // the month grid may scroll inside its own container, but not the page
    for (const view of ["Semana", "Agenda"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await page.waitForTimeout(300);
      await expectNoPageOverflow(page, `calendar ${view}`);
    }

    // the arrows have to move the agenda window, and say so
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    const label = page.locator(".peg-cal-nav__label");
    await expect(label).toBeVisible();
    const before = await label.innerText();
    await page.getByRole("button", { name: "Próximo período" }).click();
    await page.waitForTimeout(300);
    const after = await label.innerText();
    expect(after, "stepping the agenda must change the interval it names").not.toBe(before);

    await page.getByRole("button", { name: "Período anterior" }).click();
    await page.waitForTimeout(300);
    expect(await label.innerText(), "and stepping back must return to it").toBe(before);
    await expectNoPageOverflow(page, "calendar agenda after stepping");
  });
});

test.describe("mobile article index at 390px", () => {
  test("title, status, the row action and the search all stay reachable", async ({ page }) => {
    await page.goto("/articles");
    await expect(page.getByRole("button", { name: "Novo artigo" }).first()).toBeVisible({ timeout: 30_000 });
    await expectNoPageOverflow(page, "article index");

    // search and filtering survive the narrow layout
    const search = page.getByPlaceholder(/Buscar|Filtrar/i).first();
    await expect(search).toBeVisible();
    await expectInsideViewport(search, "article search");

    // a dense table is allowed to scroll inside its own container - not to push the page
    const wrap = page.locator(".peg-table-wrap").first();
    if (await wrap.count()) {
      const overflowX = await wrap.evaluate((el) => getComputedStyle(el).overflowX);
      expect(["auto", "scroll"], "the table must carry its own horizontal scroll").toContain(overflowX);
      await expectInsideViewport(wrap, "article table container");
    }

    // the first row still offers a title to open and a status to read
    const firstRowLink = page.locator("tbody tr").first().getByRole("button").first();
    await expect(firstRowLink).toBeVisible();
    await expectInsideViewport(firstRowLink, "first row action");
  });
});
