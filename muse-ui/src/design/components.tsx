// Shared experience utilities: reduced-motion hooks, camera pacing, and the
// single coherent icon family (Lucide React, 16px, currentColor — never emoji
// as interface icons). Renderers and chrome import camera pacing from here so
// camera travel and UI mount motion stay on separate reduced-motion gates.

import { useEffect, useState } from "react";
import {
  BookOpen,
  Box,
  FileText,
  Globe,
  Layers,
  LayoutGrid,
  CircleHelp,
  X,
  type LucideIcon,
} from "lucide-react";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Gate 2 — camera travel pacing: every camera call resolves its duration
 * through this helper so reduced-motion users get an instant, state-
 * preserving cut. UI mount/layout transitions (Motion, CSS) are gated
 * separately via MotionConfig reducedMotion="user" plus the
 * prefers-reduced-motion CSS block — never through this helper.
 */
export function cameraDuration(baseMs: number, reduced?: boolean): number {
  const isReduced = reduced ?? prefersReducedMotion();
  return isReduced ? 0 : baseMs;
}

/** One coherent inline icon set for chrome; renderers never draw UI icons. */
export const MODE_ICONS: Record<string, LucideIcon> = {
  map: Globe,
  "3d": Box,
  split: LayoutGrid,
  narrative: BookOpen,
  report: FileText,
};

export const CHROME_ICONS = {
  layers: Layers,
  help: CircleHelp,
  close: X,
} as const satisfies Record<string, LucideIcon>;
