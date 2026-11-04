import { expect, test } from "@playwright/test";

const SHOTS = "verification/refine-scene-first-design-foundation/screenshots";

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
  await page.screenshot({ path: `${SHOTS}/../diagnostics/basemap-failure.png` });
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
  // Secondary controls are one tap away in the compact command bar.
  for (const trigger of ["btn-spatial", "btn-import", "btn-limits", "btn-help"]) {
    await expect(page.getByTestId(trigger)).toBeVisible();
  }
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  // Keyboard focus is visible on essential non-canvas controls.
  await page.getByTestId("btn-home").focus();
  await expect(page.getByTestId("btn-home")).toBeFocused();
  expect(errors).toEqual([]);
});
