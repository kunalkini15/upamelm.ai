import { describe, expect, it } from "vitest";
import { layerDash, markerShape, LAYER_DASHES, MARKER_SHAPES } from "./channels.ts";
import { TOKENS, contrastRatio, rgbDistance, simulateCvd } from "./tokens.ts";

// Automated contrast gates from design-review item 1. Measured values are
// recorded in DESIGN_SYSTEM.md; these assertions keep tokens honest.
describe("design tokens", () => {
  it("body text meets WCAG AA (4.5:1) on surfaces", () => {
    expect(contrastRatio(TOKENS.ink, TOKENS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.muted, TOKENS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.muted, TOKENS.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.accent, TOKENS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.error, TOKENS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.ok, TOKENS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.uncertainty, TOKENS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.warn, TOKENS.warnBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("focus, selection, and canvas markers meet 3:1 at rendered size", () => {
    expect(contrastRatio(TOKENS.surface, TOKENS.focus)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(TOKENS.focus, TOKENS.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(TOKENS.evidenceMark, TOKENS.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(TOKENS.selectionMark, TOKENS.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(TOKENS.surface, TOKENS.selection)).toBeGreaterThanOrEqual(3);
    for (const cat of TOKENS.cat) {
      expect(
        contrastRatio(cat, TOKENS.canvas),
        `categorical ${cat} on canvas`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("categorical ramp is Okabe-Ito order and complete", () => {
    expect(TOKENS.cat).toHaveLength(8);
    expect(TOKENS.cat[0]).toBe("#0072B2");
    expect(new Set(TOKENS.cat).size).toBe(8);
  });

  it("CVD simulation merges only a bounded number of pairs; non-color channels cover the rest", () => {
    // Color is never the sole carrier (legend label + dash/shape always
    // accompany it), so the automated bar is: at most three confusable pairs
    // per deficiency, and every slot has a distinct non-color channel.
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"] as const) {
      const simmed = TOKENS.cat.map((c) => simulateCvd(c, kind));
      let confusable = 0;
      for (let i = 0; i < simmed.length; i++) {
        for (let j = i + 1; j < simmed.length; j++) {
          if (rgbDistance(simmed[i]!, simmed[j]!) < 45) confusable++;
        }
      }
      expect(confusable, `${kind} confusable pairs`).toBeLessThanOrEqual(3);
    }
    expect(new Set(TOKENS.cat.map((_, i) => JSON.stringify(layerDash(i)))).size).toBe(
      LAYER_DASHES.length,
    );
    expect(new Set(TOKENS.cat.map((_, i) => markerShape(i))).size).toBe(
      MARKER_SHAPES.length,
    );
  });
});
