import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { InteractionProvider } from "../interaction/store.tsx";

// Server-side composition smoke test: proves the shell, all five modes, the
// compact command bar, and every on-demand trigger render without a browser
// or WebGL context. Empty states live on demand (spatial popover, limits
// popover, import dialog) so they are asserted through the browser suite.
// MapLibre/Three.js effects never run here; the browser suite owns them.
describe("application shell composition", () => {
  const html = renderToStaticMarkup(
    <InteractionProvider>
      <App />
    </InteractionProvider>,
  );

  it("renders the shell with all five permanent modes", () => {
    for (const mode of ["map", "3d", "split", "narrative", "report"]) {
      expect(html).toContain(`data-testid="mode-${mode}"`);
    }
    expect(html).toContain("No package loaded");
  });

  it("exposes layers, import, limitations, and help as on-demand triggers", () => {
    for (const trigger of ["btn-spatial", "btn-import", "btn-limits", "btn-help"]) {
      expect(html).toContain(`data-testid="${trigger}"`);
    }
    // No permanently open rail, strip, or footer competes with the scene.
    expect(html).not.toContain("mode-3d-reason-strip");
    expect(html).not.toContain("limit-strip");
    expect(html).not.toContain("No study layers yet");
    expect(html).not.toContain("Nothing selected");
  });

  it("discloses the disabled-3D reason in the accessibility tree", () => {
    expect(html).toContain('data-testid="mode-3d-reason-disclosure"');
    expect(html).toContain("Needs located 3D evidence");
    expect(html).toContain('data-testid="mode-3d"');
  });

  it("emits no executable markup from display strings", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=");
  });
});
