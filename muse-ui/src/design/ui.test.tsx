import { describe, expect, it } from "vitest";
import { buttonClass } from "./ui.tsx";
import { TOKENS } from "./tokens.ts";

// Unit coverage for the locally owned component foundation: every variant
// must draw only on measured theme tokens (or structural utilities), never
// on a default component-library palette.
describe("component foundation variants", () => {
  const themeColors = new Set(
    [
      "canvas",
      "surface",
      "raised",
      "ink",
      "muted",
      "line",
      "focus",
      "accent",
      "selection",
      "mark",
      "evidence",
      "ok",
      "warn",
      "warnbg",
      "error",
      "uncertainty",
      "grid",
      "seq1",
      "seq2",
      "white",
      "transparent",
      "current",
    ].flatMap((c) => [`bg-${c}`, `text-${c}`, `border-${c}`, `decoration-${c}`, `fill-${c}`, `outline-${c}`]),
  );

  // Tailwind default palette stems that must never leak into chrome.
  const banned = [
    "slate",
    "gray",
    "zinc",
    "neutral",
    "stone",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
  ];

  for (const variant of ["primary", "secondary", "ghost", "destructive", "icon"] as const) {
    it(`${variant} uses only theme colors`, () => {
      const classes = `${buttonClass(variant)} ${buttonClass(variant, true)}`;
      for (const stem of banned) {
        expect(classes, `${variant} leaks default palette ${stem}`).not.toMatch(
          new RegExp(`-(?:bg|text|border|decoration|fill|outline)-${stem}-`),
        );
      }
      const candidates = classes.match(/(?:bg|text|border|decoration|fill|outline)-[a-z0-9/]+/g) ?? [];
      // Only color-carrying values are gated; sizes (text-sm) skip the gate.
      const colorClasses = candidates.filter((c) => /-(?:ink|surface|raised|muted|line|focus|accent|selection|mark|evidence|ok|warn|warnbg|error|uncertainty|grid|seq1|seq2|white|black|transparent|current|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:\/|$)/.test(c));
      expect(colorClasses.length).toBeGreaterThan(0);
      for (const cls of colorClasses) {
        expect(themeColors, `${variant} class ${cls}`).toContain(cls);
      }
    });
  }

  it("theme tokens match the asserted source of truth", () => {
    expect(TOKENS.accent).toBe("#1D4E75");
    expect(TOKENS.surface).toBe("#FFFFFF");
  });
});
