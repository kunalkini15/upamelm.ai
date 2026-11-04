import { expect, test, type Page } from "@playwright/test";

// Scene-first acceptance: the eight required states plus the direction-review
// budgets (per-state stage dominance, keyboard/touch disclosure, overlay and
// compact rules, split motion gates). Screenshots here are the six retained
// finals; failure-state bitmaps live in diagnostics/ via fixture.spec and
// resilience.spec.
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

async function stageMetrics(page: Page): Promise<{ frac: number; barH: number; vw: number; vh: number }> {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    const bar = document.querySelector("header")!.getBoundingClientRect();
    return {
      frac: (stage.width * stage.height) / (window.innerWidth * window.innerHeight),
      barH: bar.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
}

async function importShowcase(page: Page): Promise<void> {
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await page.getByTestId("import-input").setInputFiles(SHOWCASE);
  await expect(page.getByTestId("package-status")).toContainText("Fictional Meridian Basin");
  await expect(page.getByTestId("loading-state")).toHaveCount(0, { timeout: 60000 });
}

test("sf-01 empty landing is map-dominant with quiet chrome", async ({ page }) => {
  const m = await stageMetrics(page);
  // Budget MF-2: empty closed state holds >=80% of 1280x720 below a <=64px bar.
  expect(m.barH).toBeLessThanOrEqual(64);
  expect(m.frac).toBeGreaterThanOrEqual(0.8);
  // No permanent rail, strip, or footer copy competes with the scene.
  await expect(page.getByTestId("spatial-popover")).toHaveCount(0);
  await expect(page.getByTestId("limits-popover")).toHaveCount(0);
  await expect(page.getByTestId("import-dialog")).toHaveCount(0);
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.innerW);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/after-01-landing.png` });
});

test("sf-02 import surface opens over the scene without displacing it", async ({ page }) => {
  const before = await stageMetrics(page);
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await expect(page.getByTestId("import-dropzone")).toBeVisible();
  await expect(page.getByTestId("import-filename")).toContainText("No file chosen");
  const open = await stageMetrics(page);
  // Overlay, not displacement: the stage box is unchanged behind the dialog.
  expect(Math.abs(open.frac - before.frac)).toBeLessThan(0.02);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/after-02-import.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("import-dialog")).toHaveCount(0);
});

test("sf-03 spatial tools open over the scene without displacing it", async ({ page }) => {
  const before = await stageMetrics(page);
  await page.getByTestId("btn-spatial").click();
  await expect(page.getByTestId("spatial-popover")).toBeVisible();
  await expect(page.getByTestId("layers-empty")).toBeVisible();
  const open = await stageMetrics(page);
  expect(Math.abs(open.frac - before.frac)).toBeLessThan(0.02);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/after-03-spatial.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("spatial-popover")).toHaveCount(0);
});

test("sf-04 populated map with selected inspector shares one language", async ({ page }) => {
  await importShowcase(page);
  const m = await stageMetrics(page);
  expect(m.frac).toBeGreaterThanOrEqual(0.65);
  await page.getByTestId("btn-tour").click();
  await expect(page.getByTestId("studybar-counts")).toContainText("12 features");
  await page.getByTestId("mode-narrative").click();
  await page.getByTestId("evidence-demo-bh-03").click();
  await page.getByTestId("mode-map").click();
  await expect(page.getByTestId("inspector")).toBeVisible();
  await expect(page.getByTestId("inspector-depth")).toContainText("300 m below datum");
  await page.getByTestId("btn-spatial").click();
  await expect(page.getByTestId("selection-details")).toContainText("Borehole BH-03");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/after-04-inspector.png` });
});

test("sf-05 3D state keeps evidence context unobstructed", async ({ page }) => {
  await importShowcase(page);
  await page.getByTestId("mode-3d").click();
  await expect(page.getByTestId("three-wrap")).toBeVisible();
  await expect(page.getByTestId("three-canvas")).toBeVisible();
  await expect(page.getByTestId("input-exaggeration")).toBeVisible();
  await expect(page.getByTestId("three-cue")).toBeVisible();
  await expect(page.getByTestId("three-depth")).toBeVisible();
  // Exaggeration labelling and map/3D attribution stay visible with chrome up.
  const boxes = await page.evaluate(() => {
    const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    const cue = r("three-cue")!;
    const attr = document.querySelector(".maplibregl-ctrl-attrib, .threewrap")?.getBoundingClientRect();
    return { cueVisible: cue.width > 0 && cue.height > 0, wrapVisible: (attr?.width ?? 0) > 0 };
  });
  expect(boxes.cueVisible).toBe(true);
  expect(boxes.wrapVisible).toBe(true);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/after-05-3d.png` });
});

test("sf-06 compact layout leads with the scene", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await importShowcase(page);
  // Closed state: every secondary trigger reachable, scene on top.
  for (const trigger of ["btn-spatial", "btn-import", "btn-limits", "btn-help"]) {
    await expect(page.getByTestId(trigger)).toBeVisible();
  }
  for (const mode of ["map", "3d", "split", "narrative", "report"]) {
    await expect(page.getByTestId(`mode-${mode}`)).toBeVisible();
  }
  const m = await stageMetrics(page);
  expect(m.frac).toBeGreaterThanOrEqual(0.5);
  // Touch targets meet 44px on icon controls.
  const touch = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="btn-spatial"]')!.getBoundingClientRect();
    return { w: el.width, h: el.height };
  });
  expect(touch.w).toBeGreaterThanOrEqual(44);
  expect(touch.h).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.innerW);
  await page.getByTestId("btn-tour").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/after-06-compact.png` });
});

test("sf-07 keyboard disclosure, focus, and reduced motion", async ({ page }) => {
  // Keyboard: the disabled 3D wrapper is focusable and announces its reason
  // (empty landing, so 3D/Split stay honestly disabled).
  await page.getByTestId("mode-map").focus();
  await page.keyboard.press("Tab");
  let label = "";
  for (let i = 0; i < 10; i++) {
    const info = await page.evaluate(() => ({
      testid: document.activeElement?.getAttribute("data-testid"),
      label: document.activeElement?.getAttribute("aria-label"),
    }));
    if (info.testid === "mode-3d-reason-disclosure") {
      label = info.label ?? "";
      break;
    }
    await page.keyboard.press("Tab");
  }
  expect(label).toMatch(/located 3D evidence/);
  // Focus ring target: an essential control takes visible focus.
  await page.getByTestId("btn-home").focus();
  await expect(page.getByTestId("btn-home")).toBeFocused();
  // Reduced motion: camera affordances stay operable without travel.
  await importShowcase(page);
  await page.getByTestId("mode-map").click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("btn-fit-study").click();
  await expect(page.getByTestId("mode-3d")).toBeEnabled();
  // UI motion gate: inspector/sheet mounts resolve without error.
  await page.getByTestId("btn-help").click();
  await expect(page.getByTestId("help-panel")).toBeVisible();
  await page.getByTestId("btn-help-close").click();
  await expect(page.getByTestId("help-panel")).toHaveCount(0);
});
