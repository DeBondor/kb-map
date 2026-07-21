"use client";

/** Reduced-motion helpers for Leaflet's JS-driven pans — the CSS
 *  prefers-reduced-motion reset can't reach flyTo/fitBounds animations.
 *  Deliberately no leaflet import: safe anywhere client-side. */

/** Live check, not cached — the user can toggle the OS setting mid-session. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Pan/zoom options honoring reduced motion — spread into flyTo/fitBounds/setView. */
export function panMotion(
  duration: number,
  easeLinearity = 0.22,
): { animate: boolean; duration: number; easeLinearity: number } {
  return prefersReducedMotion()
    ? { animate: false, duration: 0, easeLinearity }
    : { animate: true, duration, easeLinearity };
}
