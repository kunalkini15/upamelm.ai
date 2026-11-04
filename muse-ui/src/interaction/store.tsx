// Unified interaction state. Map, 3D, split, narrative, and report surfaces
// share this serializable contract; renderers subscribe to it independently
// and never couple to one another (BASELINE.md I1/I2).

import React, { createContext, useContext, useMemo, useReducer } from "react";

export interface InteractionState {
  activeFeatureId: string | null;
  hoveredFeatureId: string | null;
  activeLayerIds: string[];
  viewMode: "map" | "3d" | "split" | "narrative" | "report";
}

export const INITIAL_INTERACTION_STATE: InteractionState = {
  activeFeatureId: null,
  hoveredFeatureId: null,
  activeLayerIds: [],
  viewMode: "map",
};

export type InteractionAction =
  | { type: "select"; featureId: string | null }
  | { type: "hover"; featureId: string | null }
  | { type: "toggleLayer"; layerId: string }
  | { type: "setLayers"; layerIds: string[] }
  | { type: "setMode"; viewMode: InteractionState["viewMode"] }
  | { type: "reset" };

export function interactionReducer(
  state: InteractionState,
  action: InteractionAction,
): InteractionState {
  switch (action.type) {
    case "select":
      return { ...state, activeFeatureId: action.featureId };
    case "hover":
      return { ...state, hoveredFeatureId: action.featureId };
    case "toggleLayer": {
      const active = state.activeLayerIds.includes(action.layerId)
        ? state.activeLayerIds.filter((id) => id !== action.layerId)
        : [...state.activeLayerIds, action.layerId];
      return { ...state, activeLayerIds: active };
    }
    case "setLayers":
      return { ...state, activeLayerIds: [...action.layerIds] };
    case "setMode":
      return { ...state, viewMode: action.viewMode };
    case "reset":
      return { ...INITIAL_INTERACTION_STATE, viewMode: state.viewMode };
  }
}

export function serializeInteraction(state: InteractionState): string {
  return JSON.stringify(state);
}

export function deserializeInteraction(raw: string): InteractionState {
  const parsed = JSON.parse(raw) as Partial<InteractionState>;
  const modes = ["map", "3d", "split", "narrative", "report"] as const;
  return {
    activeFeatureId:
      typeof parsed.activeFeatureId === "string" ? parsed.activeFeatureId : null,
    hoveredFeatureId:
      typeof parsed.hoveredFeatureId === "string" ? parsed.hoveredFeatureId : null,
    activeLayerIds: Array.isArray(parsed.activeLayerIds)
      ? parsed.activeLayerIds.filter((id): id is string => typeof id === "string")
      : [],
    viewMode: modes.includes(parsed.viewMode as (typeof modes)[number])
      ? (parsed.viewMode as InteractionState["viewMode"])
      : "map",
  };
}

interface InteractionContextValue {
  state: InteractionState;
  dispatch: React.Dispatch<InteractionAction>;
}

const InteractionContext = createContext<InteractionContextValue | null>(null);

export function InteractionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(interactionReducer, INITIAL_INTERACTION_STATE);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>;
}

export function useInteraction(): InteractionContextValue {
  const ctx = useContext(InteractionContext);
  if (!ctx) throw new Error("useInteraction must be used inside InteractionProvider");
  return ctx;
}
