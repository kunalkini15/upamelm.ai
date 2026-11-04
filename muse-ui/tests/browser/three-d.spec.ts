import { expect, test } from "@playwright/test";

// Proves the previously unreachable enabled-3D path: a validated package
// with located finite heights unlocks the Three.js workspace, which renders
// evidence-derived columns (never invented geometry) with orbit, reset,
// orientation cue, clipping, and labelled vertical exaggeration.
const SHOTS = "verification/bootstrap-default/screenshots";
const SYNTHETIC_3D = "tests/fixtures/synthetic-3d-package.json";

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

test("validated heights enable the 3D workspace with evidence geometry", async ({ page }) => {
  await page.getByTestId("import-input").setInputFiles(SYNTHETIC_3D);
  await expect(page.getByTestId("package-status")).toContainText("TEST FIXTURE");
  // Let the world map boot so the loading veil is gone before mode switching.
  await expect(page.getByTestId("loading-state")).toHaveCount(0, { timeout: 60000 });

  // The flat synthetic fixture leaves 3D disabled; validated heights unlock it.
  await expect(page.getByTestId("mode-3d")).toBeEnabled();
  await expect(page.getByTestId("mode-split")).toBeEnabled();
  await page.getByTestId("mode-3d").click();

  await expect(page.getByTestId("three-wrap")).toBeVisible();
  await expect(page.getByTestId("three-canvas")).toBeVisible();
  await expect(page.getByTestId("three-disabled")).toHaveCount(0);
  await expect(page.getByTestId("three-provenance")).toContainText("4 evidence column(s)");
  await expect(page.getByTestId("three-provenance")).toContainText("meters as validated");
  await expect(page.getByTestId("three-cue")).toBeVisible();

  const three = await page.evaluate(
    () => (window as unknown as { __museThree?: { featureCount: () => number; selectedId: () => string | null } }).__museThree
      ? {
          count: (window as unknown as { __museThree: { featureCount: () => number } }).__museThree.featureCount(),
          selected: (window as unknown as { __museThree: { selectedId: () => string | null } }).__museThree.selectedId(),
        }
      : null,
  );
  expect(three?.count).toBe(4);
  expect(three?.selected).toBeNull();

  // Orbit/reset, exaggeration, and clipping controls are operable.
  await expect(page.getByTestId("btn-three-home")).toBeEnabled();
  await page.getByTestId("btn-three-home").click();
  await page.getByTestId("input-exaggeration").fill("3");
  await expect(page.getByTestId("input-exaggeration")).toHaveValue("3");
  await page.getByTestId("input-clip-enabled").check();
  await expect(page.getByTestId("input-clip-enabled")).toBeChecked();

  // Selection coordinates into 3D: narrative evidence focuses the same
  // feature in the side panel and the 3D highlight handle.
  await page.getByTestId("mode-narrative").click();
  await page.getByTestId("evidence-syn3d-a").click();
  await expect(page.getByTestId("selection-details")).toContainText("Synthetic mast A");
  await page.getByTestId("mode-3d").click();
  await expect(page.getByTestId("three-canvas")).toBeVisible();
  const selected = await page.evaluate(
    () => (window as unknown as { __museThree?: { selectedId: () => string | null } }).__museThree?.selectedId() ?? null,
  );
  expect(selected).toBe("syn3d-a");

  // Keep the provenance caption and toolbar inside the retained frame.
  await expect(page.getByTestId("three-provenance")).toBeVisible();
  await expect(page.getByTestId("btn-three-home")).toBeVisible();
  await expect(page.getByTestId("input-exaggeration")).toBeVisible();
  await expect(page.getByTestId("input-clip-enabled")).toBeVisible();
  await page.getByTestId("three-wrap").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/04-3d-enabled.png` });
});
