import { expect, test } from "@playwright/test";

const SHOTS = "verification/bootstrap-default/screenshots";
const SYNTHETIC = "tests/fixtures/synthetic-package.json";
const OUTDATED = "tests/fixtures/outdated-package.json";

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  const errors = pageErrors;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/net::|favicon|tiles\.openfreemap|Failed to load resource/i.test(msg.text())) {
      errors.push(msg.text());
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
});

test.afterEach(async () => {
  expect(pageErrors, `uncaught app errors: ${pageErrors.join("; ")}`).toEqual([]);
});

test("validated import drives layers, selection, fit, and coordination", async ({ page }) => {
  await page.getByTestId("import-input").setInputFiles(SYNTHETIC);
  await expect(page.getByTestId("package-status")).toContainText("TEST FIXTURE");
  await expect(page.getByTestId("layer-toggle-syn-points")).toBeVisible();
  await expect(page.getByTestId("layer-toggle-syn-paths")).toBeVisible();

  // Layer toggling works against the validated scene.
  await page.getByTestId("layer-toggle-syn-points").click();
  await expect(page.getByTestId("layer-toggle-syn-points")).not.toBeChecked();
  await page.getByTestId("layer-toggle-syn-points").click();
  await expect(page.getByTestId("layer-toggle-syn-points")).toBeChecked();

  // Fit-to-study frames the synthetic extent (no fabricated camera jump).
  const before = await page.evaluate(() => {
    const h = (window as unknown as { __museMap?: { center: () => object; zoom: () => number } }).__museMap;
    return { center: h?.center(), zoom: h?.zoom() };
  });
  await page.getByTestId("btn-fit-study").click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const h = (window as unknown as { __museMap?: { center: () => object; zoom: () => number } }).__museMap;
    return { center: h?.center(), zoom: h?.zoom() };
  });
  expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));

  // Narrative evidence selection focuses the same feature in the side panel.
  await page.getByTestId("mode-narrative").click();
  await expect(page.getByTestId("narrative-list")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-narrative.png` });
  await page.getByTestId("evidence-syn-a").click();
  await expect(page.getByTestId("selection-details")).toContainText("Synthetic point A");
  await expect(page.getByTestId("evidence-syn-a")).toHaveClass(/active/);

  await page.getByTestId("mode-map").click();
  await expect(page.getByTestId("selection-details")).toContainText("Synthetic point A");
  await expect(page.getByTestId("btn-fit-selection")).toBeEnabled();
  // Malformed per-feature geometry is quarantined, not rendered.
  await expect(page.getByTestId("limitations")).toContainText("syn-broken");
  // No screenshot here: the slot is reallocated to the enabled-3D evidence
  // capture (04-3d-enabled.png); coordination assertions above still run.
});

test("malformed import explains failure and preserves the last valid scene", async ({ page }) => {
  await page.getByTestId("import-input").setInputFiles(SYNTHETIC);
  await expect(page.getByTestId("package-status")).toContainText("TEST FIXTURE");

  await page.getByTestId("import-input").setInputFiles(OUTDATED);
  await expect(page.getByTestId("import-errors")).toContainText("Unsupported package schema");
  // The last valid package is preserved, not replaced by the failure.
  await expect(page.getByTestId("package-status")).toContainText("TEST FIXTURE");
  await expect(page.getByTestId("layer-toggle-syn-points")).toBeChecked();
  await expect(page.getByTestId("loading-state")).toHaveCount(0, { timeout: 60000 });
  await page.getByTestId("import-errors").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/06-import-error.png` });
});

test("fixture map state screenshot", async ({ page }) => {
  await page.getByTestId("import-input").setInputFiles(SYNTHETIC);
  await expect(page.getByTestId("package-status")).toContainText("TEST FIXTURE");
  await page.getByTestId("btn-fit-study").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/03-fixture-map.png` });
});
