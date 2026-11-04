import { expect, test } from "@playwright/test";

const SHOTS = "verification/refine-scene-first-design-foundation/screenshots";

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  const errors = pageErrors;
  page.on("pageerror", (e) => errors.push(String(e)));
  // App-level console errors fail the run; tile/network noise does not.
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/net::|favicon|tiles\.openfreemap|Failed to load resource/i.test(msg.text())) {
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

test("neutral landing: world map, modes, on-demand empty states", async ({ page }) => {
  await expect(page.getByTestId("package-status")).toContainText("No package loaded");
  for (const mode of ["map", "3d", "split", "narrative", "report"]) {
    await expect(page.getByTestId(`mode-${mode}`)).toBeVisible();
  }
  await expect(page.getByTestId("mode-3d")).toBeDisabled();
  await expect(page.getByTestId("mode-split")).toBeDisabled();
  await expect(page.getByTestId("mode-3d")).toHaveAttribute("title", /located 3D evidence/);
  // No permanent reason strip: disclosure lives on the disabled control.
  await expect(page.getByTestId("mode-3d-reason-disclosure")).toContainText("located 3D evidence");
  await expect(page.getByTestId("three-disabled")).toHaveCount(0);

  // Map controls and attribution are present on the world view.
  await expect(page.getByTestId("btn-home")).toBeVisible();
  await expect(page.getByTestId("btn-projection")).toContainText("mercator");
  await expect(page.getByTestId("btn-fit-study")).toBeDisabled();
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  await expect(attribution).toBeVisible();
  expect(((await attribution.innerText()) ?? "").length).toBeGreaterThan(0);

  // Projection switching preserves a usable world map.
  await page.getByTestId("btn-projection").click();
  await expect(page.getByTestId("btn-projection")).toContainText("globe");
  await page.getByTestId("btn-projection").click();
  await expect(page.getByTestId("btn-projection")).toContainText("mercator");

  // Empty narrative/report surfaces stay reachable.
  await page.getByTestId("mode-narrative").click();
  await expect(page.getByTestId("narrative-empty")).toContainText("No narrative insights yet");
  await page.getByTestId("mode-report").click();
  await expect(page.getByTestId("report-empty")).toContainText("No report sections yet");
  await page.getByTestId("mode-map").click();

  // Empty states live on demand, not in a permanent rail.
  await page.getByTestId("btn-spatial").click();
  await expect(page.getByTestId("layers-empty")).toBeVisible();
  await expect(page.getByTestId("selection-details")).toContainText("Nothing selected");
  await page.keyboard.press("Escape");
  await page.getByTestId("btn-limits").click();
  await expect(page.getByTestId("limitations")).toContainText("No study evidence yet");
  await page.keyboard.press("Escape");

  // Let remote tiles settle so the retained landing capture shows the world map.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/reg-landing.png` });
});

test("disabled 3D states honestly", async ({ page }) => {
  await page.getByTestId("mode-3d").click({ force: true }).catch(() => {});
  // Disabled buttons cannot be activated; the reason is exposed instead.
  await expect(page.getByTestId("mode-3d")).toBeDisabled();
  await expect(page.getByTestId("three-disabled")).toHaveCount(0);
});
