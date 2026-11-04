import { expect, test } from "@playwright/test";

const SHOTS = "verification/bootstrap-default/screenshots";

test("remote basemap failure falls back to the bundled neutral style", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Block every remote tile/style host; the bundled fallback must take over.
  await page.route(/tiles\.openfreemap\.org/, (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("basemap-notice")).toContainText("bundled neutral fallback");
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  // Controls and attribution stay usable on the fallback.
  await expect(page.getByTestId("btn-home")).toBeEnabled();
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  await expect(attribution).toContainText(/Fallback|bundled/i);
  const styleName = await page.evaluate(
    () => (window as unknown as { __museMap?: { styleName: () => string } }).__museMap?.styleName(),
  );
  expect(styleName).toMatch(/fallback/i);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/02-fallback.png` });
});

test("compact layout keeps essential controls usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  for (const mode of ["map", "3d", "split", "narrative", "report"]) {
    await expect(page.getByTestId(`mode-${mode}`)).toBeVisible();
  }
  await expect(page.getByTestId("btn-home")).toBeVisible();
  await expect(page.getByTestId("import-input")).toBeVisible();
  // Keyboard focus is visible on essential non-canvas controls.
  await page.getByTestId("btn-home").focus();
  await expect(page.getByTestId("btn-home")).toBeFocused();
  expect(errors).toEqual([]);
});
