import { describe, expect, it } from "vitest";
import {
  deserializeInteraction,
  INITIAL_INTERACTION_STATE,
  interactionReducer,
  serializeInteraction,
} from "./store.tsx";

describe("unified interaction state", () => {
  it("covers the exact serializable contract", () => {
    expect(Object.keys(INITIAL_INTERACTION_STATE).sort()).toEqual(
      ["activeFeatureId", "activeLayerIds", "hoveredFeatureId", "viewMode"].sort(),
    );
    expect(INITIAL_INTERACTION_STATE).toEqual({
      activeFeatureId: null,
      hoveredFeatureId: null,
      activeLayerIds: [],
      viewMode: "map",
    });
  });

  it("selects, hovers, toggles layers, and switches modes", () => {
    let state = INITIAL_INTERACTION_STATE;
    state = interactionReducer(state, { type: "select", featureId: "f1" });
    expect(state.activeFeatureId).toBe("f1");
    state = interactionReducer(state, { type: "hover", featureId: "f2" });
    expect(state.hoveredFeatureId).toBe("f2");
    state = interactionReducer(state, { type: "toggleLayer", layerId: "l1" });
    state = interactionReducer(state, { type: "toggleLayer", layerId: "l2" });
    expect(state.activeLayerIds).toEqual(["l1", "l2"]);
    state = interactionReducer(state, { type: "toggleLayer", layerId: "l1" });
    expect(state.activeLayerIds).toEqual(["l2"]);
    state = interactionReducer(state, { type: "setMode", viewMode: "narrative" });
    expect(state.viewMode).toBe("narrative");
    // Any surface can clear the shared selection.
    state = interactionReducer(state, { type: "select", featureId: null });
    expect(state.activeFeatureId).toBeNull();
  });

  it("round-trips through JSON and falls back safely", () => {
    const state = {
      activeFeatureId: "f1",
      hoveredFeatureId: null,
      activeLayerIds: ["l1"],
      viewMode: "split" as const,
    };
    expect(deserializeInteraction(serializeInteraction(state))).toEqual(state);
    expect(deserializeInteraction('{"viewMode":"bogus","activeLayerIds":[1,null,"l2"]}')).toEqual({
      activeFeatureId: null,
      hoveredFeatureId: null,
      activeLayerIds: ["l2"],
      viewMode: "map",
    });
  });
});
