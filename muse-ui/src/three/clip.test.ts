import { MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { applyClipState, createClipState } from "./ThreeViewport.tsx";

describe("3D clipping state (pure, no GL context)", () => {
  it("starts disabled at height zero", () => {
    expect(createClipState()).toEqual({ enabled: false, height: 0 });
  });

  it("clears clipping planes when disabled", () => {
    const material = new MeshBasicMaterial();
    material.clippingPlanes = [];
    expect(applyClipState([material], { enabled: false, height: 2 })).toEqual([]);
    expect(material.clippingPlanes).toBeNull();
  });

  it("applies one clip plane above the configured height when enabled", () => {
    const material = new MeshBasicMaterial();
    const planes = applyClipState([material], { enabled: true, height: 1.5 });
    expect(planes).toHaveLength(1);
    expect(planes[0]?.constant).toBe(1.5);
    expect(material.clippingPlanes).toHaveLength(1);
  });
});
