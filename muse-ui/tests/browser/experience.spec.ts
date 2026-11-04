import { expect, test, type Page } from "@playwright/test";

// Experience-foundation acceptance: the deterministic fictional showcase
// exercises the observatory end to end. Fixture ids use the demo- prefix and
// the fixture is never registered; src/ contains no demo- branches.
const SHOTS = "verification/refine-scene-first-design-foundation/screenshots";
const SHOWCASE = "verification/experience-foundation/showcase-package.json";

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  const errors = pageErrors;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/net::|favicon|tiles\.openfreemap|Failed to load resource|WebGL/i.test(msg.text())) {
      errors.push(msg.text());
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
});

test.afterEach(async () => {
  expect(pageErrors, `uncaught app errors: ${pageErrors.join("; ")}`).toEqual([]);
});

async function importShowcase(page: Page): Promise<void> {
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await page.getByTestId("import-input").setInputFiles(SHOWCASE);
  await expect(page.getByTestId("package-status")).toContainText("Fictional Meridian Basin");
  await expect(page.getByTestId("loading-state")).toHaveCount(0, { timeout: 60000 });
}

test("xf-01 quiet global landing with one world view", async ({ page }) => {
  await expect(page.getByTestId("package-status")).toContainText("No package loaded");
  await expect(page.getByTestId("mode-3d")).toBeDisabled();
  await page.waitForTimeout(2500);
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    scrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
  }));
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.innerW);
  await page.screenshot({ path: `${SHOTS}/xf-01-landing.png` });
});

test("xf-02 synthetic study map overview via tour", async ({ page }) => {
  await importShowcase(page);
  // Canvas-first: the stage holds >=65% of the desktop viewport in map mode.
  const frac = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    return (stage.width * stage.height) / (window.innerWidth * window.innerHeight);
  });
  expect(frac).toBeGreaterThanOrEqual(0.65);
  // Orient rhythm: tour frames the study, then offers the 3D overview.
  await page.getByTestId("btn-tour").click();
  await expect(page.getByTestId("btn-tour")).toContainText("Open 3D overview");
  await expect(page.getByTestId("studybar-counts")).toContainText("12 features");
  await expect(page.getByTestId("studybar-uncertainty")).toBeVisible();
  await page.getByTestId("btn-spatial").click();
  for (const layer of ["demo-boundary", "demo-boreholes", "demo-horizons", "demo-water", "demo-transect"]) {
    await expect(page.getByTestId(`layer-toggle-${layer}`)).toBeVisible();
  }
  await page.keyboard.press("Escape");
  for (const layer of ["demo-boundary", "demo-boreholes", "demo-horizons", "demo-water", "demo-transect"]) {
    await expect(page.getByTestId(`legend-row-${layer}`)).toBeVisible();
  }
  await page.getByTestId("btn-limits").click();
  await expect(page.getByTestId("limitations")).toContainText("Fictional design probe");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/xf-02-map-overview.png` });
});

test("xf-03 selected evidence with inspector and legend", async ({ page }) => {
  await importShowcase(page);
  await page.getByTestId("mode-narrative").click();
  await page.getByTestId("evidence-demo-bh-03").click();
  await page.getByTestId("mode-map").click();
  // Shared selection: narrative chip focuses the same evidence everywhere.
  await page.getByTestId("btn-spatial").click();
  await expect(page.getByTestId("selection-details")).toContainText("Borehole BH-03");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector")).toBeVisible();
  await expect(page.getByTestId("inspector-depth")).toContainText("300 m below datum");
  await expect(page.getByTestId("inspector-uncertainty")).toContainText("±2 m");
  await expect(page.getByTestId("inspector-provenance")).toContainText("EPSG:4326");
  await expect(page.getByTestId("legend")).toBeVisible();
  // Spatial focus by default: arriving from narrative already framed the
  // study on the map (BH-03 at lon -37.95, lat -47.95 sits inside the
  // framed study bounds), with no manual step.
  await expect(page.getByTestId("btn-show-on-map")).toBeVisible();
  await page.waitForTimeout(700);
  const framed = await page.evaluate(() => {
    const h = (window as unknown as { __museMap?: { center: () => { lng: number; lat: number } } }).__museMap;
    return h?.center();
  });
  expect(framed!.lng).toBeGreaterThan(-38.3);
  expect(framed!.lng).toBeLessThan(-37.7);
  expect(framed!.lat).toBeGreaterThan(-48.18);
  expect(framed!.lat).toBeLessThan(-47.82);
  await page.getByTestId("btn-show-on-map").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/xf-03-selected.png` });
});

test("xf-04 composed 3D overview with provenance", async ({ page }) => {
  await importShowcase(page);
  await page.getByTestId("mode-3d").click();
  await expect(page.getByTestId("three-wrap")).toBeVisible();
  await expect(page.getByTestId("three-canvas")).toBeVisible();
  await expect(page.getByTestId("three-provenance")).toContainText("6 evidence column(s)");
  await expect(page.getByTestId("three-provenance")).toContainText("4 subsurface plane(s)");
  await expect(page.getByTestId("three-provenance")).toContainText("1 section(s)");
  await expect(page.getByTestId("three-provenance")).toContainText("meters as validated");
  await expect(page.getByTestId("three-cue")).toBeVisible();
  const three = await page.evaluate(
    () =>
      (
        window as unknown as {
          __museThree?: {
            featureCount: () => number;
            drawCalls: () => number;
            anchor: () => { lon: number; lat: number } | null;
          };
        }
      ).__museThree!,
  );
  const snapshot = await page.evaluate(() => {
    const h = (window as unknown as { __museThree?: { featureCount: () => number; drawCalls: () => number } }).__museThree;
    return { count: h?.featureCount(), calls: h?.drawCalls() };
  });
  expect(snapshot.count).toBe(11);
  expect(snapshot.calls).toBeGreaterThan(0);
  expect(snapshot.calls).toBeLessThan(500);
  expect(three).toBeDefined();
  await expect(page.getByTestId("input-exaggeration")).toBeVisible();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/xf-04-3d-overview.png` });
});

test("xf-05 clipped section state with schematic exaggeration", async ({ page }) => {
  await importShowcase(page);
  await page.getByTestId("mode-3d").click();
  await expect(page.getByTestId("three-canvas")).toBeVisible();
  // Section preset: clip at the validated reference water level.
  await expect(page.getByTestId("btn-clip-water")).toBeEnabled();
  await page.getByTestId("btn-clip-water").click();
  await expect(page.getByTestId("input-clip-enabled")).toBeChecked();
  await expect(page.getByTestId("input-clip-height")).toHaveValue("-15");
  await page.getByTestId("input-exaggeration").fill("2");
  await expect(page.getByTestId("input-exaggeration")).toHaveValue("2");
  // Investigative payoff: the clip state names its datum and intersection count.
  await expect(page.getByTestId("clip-status")).toContainText("-15 m");
  await expect(page.getByTestId("clip-status")).toContainText("cross the plane");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/xf-05-section-clipped.png` });
});

test("xf-06 narrative coordinated with spatial selection", async ({ page }) => {
  await importShowcase(page);
  await page.getByTestId("mode-narrative").click();
  await expect(page.getByTestId("narrative-list")).toBeVisible();
  await page.getByTestId("evidence-demo-horizon-c").click();
  await page.getByTestId("btn-spatial").click();
  await expect(page.getByTestId("selection-details")).toContainText("Horizon C");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("evidence-demo-horizon-c")).toHaveClass(/active/);
  // Selection survives into the report surface with the map still mounted.
  await page.getByTestId("mode-report").click();
  await expect(page.getByTestId("report-list")).toBeVisible();
  await page.getByTestId("evidence-demo-bh-03").click();
  await page.getByTestId("btn-spatial").click();
  await expect(page.getByTestId("selection-details")).toContainText("Borehole BH-03");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  // Report continuity: selecting BH-03 from the report framed the study on
  // the mounted map instead of leaving the world extent behind.
  await page.waitForTimeout(700);
  const reportFramed = await page.evaluate(() => {
    const h = (window as unknown as { __museMap?: { center: () => { lng: number; lat: number } } }).__museMap;
    return h?.center();
  });
  expect(reportFramed!.lng).toBeGreaterThan(-38.3);
  expect(reportFramed!.lng).toBeLessThan(-37.7);
  expect(reportFramed!.lat).toBeGreaterThan(-48.18);
  expect(reportFramed!.lat).toBeLessThan(-47.82);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/xf-06-narrative.png` });
});

test("compact layout, keyboard path, and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await importShowcase(page);
  for (const mode of ["map", "3d", "split", "narrative", "report"]) {
    await expect(page.getByTestId(`mode-${mode}`)).toBeVisible();
  }
  await expect(page.getByTestId("btn-home")).toBeVisible();
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.innerW);
  // Keyboard: tab from the top reaches an operable control quickly.
  await page.keyboard.press("Tab");
  let tag = "";
  for (let i = 0; i < 15; i++) {
    tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    if (tag === "BUTTON" || tag === "INPUT") break;
    await page.keyboard.press("Tab");
  }
  expect(["BUTTON", "INPUT"]).toContain(tag);
  // Retained compact evidence (supplementary 390px capture): the framed
  // study leads, chrome condenses, nothing overflows. Dismissing the
  // limitation banner keeps every control whole at this width.
  await page.getByTestId("btn-tour").click();
  await page.waitForTimeout(800);
  await page.getByTestId("btn-limits").click();
  await expect(page.getByTestId("limitations")).toContainText("Fictional design probe");
  await page.getByTestId("btn-limit-dismiss").click();
  await expect(page.getByTestId("limits-popover")).toHaveCount(0);
  await page.evaluate(() => {
    document.querySelector('[data-testid="stage"]')?.scrollIntoView();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/xf-07-compact.png` });
  // Human evidence names, never raw fixture ids, in user-facing chips.
  await page.getByTestId("mode-narrative").click();
  await expect(page.getByTestId("evidence-demo-horizon-c")).toContainText("Horizon C");
  await expect(page.getByTestId("evidence-demo-horizon-c")).not.toContainText("demo-horizon-c");
  // Reduced motion: camera affordances stay operable without travel.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("mode-map").click();
  await page.getByTestId("btn-fit-study").click();
  await expect(page.getByTestId("mode-3d")).toBeEnabled();
});
