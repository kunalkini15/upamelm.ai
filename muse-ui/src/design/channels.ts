// Non-color identity channels. Every categorical color assignment must pair
// with one of these text/shape/dash channels (DESIGN_SYSTEM.md): color never
// carries meaning alone, which is what keeps CVD-merged pairs distinguishable.

/** Dash patterns assigned to layer slots in order; index i uses DASHES[i % len]. */
export const LAYER_DASHES: Array<readonly number[]> = [
  [],
  [6, 3],
  [2, 2],
  [8, 3, 2, 3],
  [12, 4],
  [4, 2, 1, 2],
  [10, 2, 4, 2],
  [1, 2],
];

/** Marker shape names assigned alongside categorical color in legends. */
export const MARKER_SHAPES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "star",
  "cross",
] as const;

export function layerDash(slot: number): readonly number[] {
  return LAYER_DASHES[((slot % LAYER_DASHES.length) + LAYER_DASHES.length) % LAYER_DASHES.length]!;
}

export function markerShape(slot: number): (typeof MARKER_SHAPES)[number] {
  return MARKER_SHAPES[((slot % MARKER_SHAPES.length) + MARKER_SHAPES.length) % MARKER_SHAPES.length]!;
}
