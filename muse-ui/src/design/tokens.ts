// Design tokens: single source of truth for the color roles defined in
// DESIGN_SYSTEM.md. styles.css carries the same values as CSS custom
// properties; this module mirrors them so automated checks (unit tests) can
// assert contrast and color-vision-deficiency robustness. Values here must
// match styles.css exactly.

export const TOKENS = {
  canvas: "#101418",
  surface: "#FFFFFF",
  surfaceRaised: "#F4F7F9",
  ink: "#101418",
  muted: "#425563",
  line: "#8A9BA8",
  focus: "#005FCC",
  accent: "#1D4E75",
  selection: "#8A4B00",
  selectionMark: "#FFB340",
  evidenceMark: "#9FD4FF",
  ok: "#007A5E",
  warn: "#8A4B00",
  warnBg: "#FDF3E0",
  error: "#8F1D1D",
  uncertainty: "#5A3EC0",
  grid: "#33404D",
  cat: [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#D55E00",
    "#F0E442",
    "#999999",
  ],
  seq: ["#0B2135", "#1D4E75", "#2E7CA8", "#88C0E0", "#F2E9C8"],
  divNeg: "#2166AC",
  divMid: "#F7F7F7",
  divPos: "#B2182B",
} as const;

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

// Machado et al. (2009) severity-1.0 simulation matrices, row-major sRGB.
// Used only to prove categorical markers stay distinguishable, never to pick
// colors by simulation alone (research.md D2).
const CVD_MATRICES = {
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
  protanopia: [
    [0.567, 0.433, 0],
    [0.558, 0.442, 0],
    [0, 0.242, 0.758],
  ],
  tritanopia: [
    [0.95, 0.05, 0],
    [0, 0.433, 0.567],
    [0, 0.475, 0.525],
  ],
} as const;

export type CvdKind = keyof typeof CVD_MATRICES;

export function simulateCvd(hex: string, kind: CvdKind): string {
  const [r, g, b] = hexToRgb(hex);
  const m = CVD_MATRICES[kind];
  const mix = (row: readonly number[]): number =>
    row[0] * r + row[1] * g + row[2] * b;
  return rgbToHex([mix(m[0]), mix(m[1]), mix(m[2])]);
}

export function rgbDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
