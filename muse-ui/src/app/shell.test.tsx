import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { InteractionProvider } from "../interaction/store.tsx";

// Server-side composition smoke test: proves the shell, all five modes, and
// the bootstrap empty states render without a browser or WebGL context.
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

  it("renders every bootstrap empty state", () => {
    expect(html).toContain("No study layers yet");
    expect(html).toContain("Nothing selected");
    expect(html).toContain("No study evidence yet");
    expect(html).toContain("Basemap");
  });

  it("emits no executable markup from display strings", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=");
  });
});
