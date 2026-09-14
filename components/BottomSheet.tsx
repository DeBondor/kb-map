"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mobile snap points (fraction of viewport visible from bottom):
 * - full: 3/4 (0.75) — reveals the timeline while keeping the top 25% of the screen
 *   open to the live map and tracked bus.
 * - half: 2/4 (0.50) — balanced half-and-half split between sheet details and map.
 * - peek: 1/4 (0.25) — compact docked bottom bar showing line pill, destination,
 *   delay, and live status without hiding the map.
 *
 * Pulling the sheet down docks it at `peek` ("przyczepianie się na dole") so the
 * line/trip remains active and pinned. To close the sheet, the user taps ✕ or Esc.
 */
const FULL = 0.75;
const HALF = 0.50;
const PEEK = 0.25;

export type Snap = "peek" | "half" | "full";

const SNAPS: Snap[] = ["full", "half", "peek"];


// Apple WWDC 2018 Fluid Interfaces rubber-band formula
function rubberband(overshoot: number, dimension: number, constant = 0.45): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

interface Props {
  onClose: () => void;
  /** md+ — render as a docked left panel instead of a draggable sheet */
  desktop: boolean;
  ariaLabel: string;
  /** mobile snap the sheet opens at (default "half" / 2/4 screen) */
  initialSnap?: Snap;
  /** allow closing via extreme downward swipe from peek (default false) */
  dismissOnDrag?: boolean;
  /** header content — on mobile this is the drag zone */
  header: React.ReactNode;
  children: React.ReactNode;
}

export default function BottomSheet({
  onClose,
  desktop,
  ariaLabel,
  initialSnap = "half",
  dismissOnDrag = false,
  header,
  children,
}: Props) {
  const [snap, setSnap] = useState<Snap>(initialSnap);
  const [isDragging, setIsDragging] = useState(false);
  const [mounted, setMounted] = useState(false);

  const sheetRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(160);
  const restoreRef = useRef<HTMLElement | null>(null);
  const snapRef = useRef<Snap>(initialSnap);
  const currentYRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  // Measure header height dynamically to bound content container precisely within viewport
  useEffect(() => {
    if (!headerRef.current) return;
    const el = headerRef.current;
    const update = () => {
      const h = el.offsetHeight;
      if (h > 0) setHeaderHeight(h);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startRef = useRef<{
    id: number;
    y: number;
    t: number;
    base: number;
    target: HTMLElement | null;
  } | null>(null);
  const movesRef = useRef<{ y: number; t: number }[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* focus restoration */
  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    sheetRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  const vh = () => (typeof window !== "undefined" ? window.innerHeight : 800);

  /** translateY (px) that leaves the chosen snap showing */
  const baseY = useCallback((s: Snap) => {
    const h = vh();
    if (s === "full") return 0;
    if (s === "half") return (FULL - HALF) * h;
    // peek: ensure at least ~156px is visible (header + delay + badges) on smaller screens
    const peekVisibleH = Math.max(PEEK * h, Math.min(156, FULL * h - 20));
    return FULL * h - peekVisibleH;
  }, []);

  // Entrance transition on mount
  useEffect(() => {
    if (desktop) return;
    snapRef.current = initialSnap;
    currentYRef.current = baseY(initialSnap);
    const raf = requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [desktop, initialSnap, baseY]);

  // Window resize handler
  useEffect(() => {
    if (desktop) return;
    const onResize = () => {
      if (isDraggingRef.current) return;
      const target = baseY(snapRef.current);
      currentYRef.current = target;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translate3d(0, ${target}px, 0)`;
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [desktop, baseY]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (desktop) return;
      if (startRef.current != null || !e.isPrimary) return;
      if ((e.target as HTMLElement).closest?.("button,a,input,[role='button']")) return;

      if (sheetRef.current) {
        sheetRef.current.style.transition = "none";
      }

      startRef.current = {
        id: e.pointerId,
        y: e.clientY,
        t: e.timeStamp,
        base: currentYRef.current || baseY(snapRef.current),
        target: e.target as HTMLElement,
      };
      movesRef.current = [{ y: e.clientY, t: e.timeStamp }];
      isDraggingRef.current = true;
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [desktop, baseY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const st = startRef.current;
      if (!st || e.pointerId !== st.id) return;

      const now = e.timeStamp;
      movesRef.current.push({ y: e.clientY, t: now });
      const cutoff = now - 80;
      while (movesRef.current.length > 0 && movesRef.current[0].t < cutoff) {
        movesRef.current.shift();
      }

      const dy = e.clientY - st.y;
      const rawY = st.base + dy;
      const fullY = baseY("full");
      const peekY = baseY("peek");
      const h = vh();

      let y = rawY;
      if (rawY < fullY) {
        // Rubberband resistance above 3/4
        y = fullY + rubberband(rawY - fullY, h, 0.45);
      } else if (rawY > peekY) {
        // Rubberband resistance below peek
        y = peekY + rubberband(rawY - peekY, h, 0.45);
      }

      currentYRef.current = y;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translate3d(0, ${y}px, 0)`;
      }
    },
    [baseY],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const st = startRef.current;
      if (!st || e.pointerId !== st.id) return;
      startRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);

      const moved = Math.abs(e.clientY - st.y);
      const elapsed = e.timeStamp - st.t;

      // Quick tap toggle
      if (moved < 6 && elapsed < 250) {
        if (!st.target?.closest?.("button,a,input,[role='button']")) {
          let nextSnap: Snap;
          if (snapRef.current === "peek") nextSnap = "half";
          else if (snapRef.current === "half") nextSnap = "full";
          else nextSnap = "half";

          snapRef.current = nextSnap;
          currentYRef.current = baseY(nextSnap);
          if (sheetRef.current) {
            sheetRef.current.style.transition = "transform 0.38s var(--ease-spring)";
            sheetRef.current.style.transform = `translate3d(0, ${baseY(nextSnap)}px, 0)`;
          }
          setSnap(nextSnap);
          return;
        }
        return;
      }

      // Compute release velocity (px/s)
      let releaseVel = 0;
      const moves = movesRef.current;
      if (moves.length >= 2) {
        const first = moves[0];
        const last = moves[moves.length - 1];
        const dt = (last.t - first.t) / 1000;
        if (dt > 0.008) {
          releaseVel = (last.y - first.y) / dt;
        }
      }

      // Momentum projection using Apple formula
      const curY = currentYRef.current;
      const projected = curY + (releaseVel / 1000) * 120;
      const peekY = baseY("peek");

      // Optional explicit swipe-to-dismiss (only if enabled & swiping fast past peek)
      if (dismissOnDrag && projected > peekY + 120 && releaseVel > 900) {
        if (sheetRef.current) {
          sheetRef.current.style.transition = "transform 0.28s ease-in";
          sheetRef.current.style.transform = `translate3d(0, ${FULL * vh()}px, 0)`;
        }
        setTimeout(onClose, 280);
        return;
      }

      // Find nearest snap point to projected landing position
      let nearest: Snap = "half";
      let bestDist = Infinity;
      for (const s of SNAPS) {
        const dist = Math.abs(projected - baseY(s));
        if (dist < bestDist) {
          bestDist = dist;
          nearest = s;
        }
      }

      // Downward drag clamps to peek ("przyczepianie się na dole", never closes!)
      if (projected >= peekY) {
        nearest = "peek";
      }

      snapRef.current = nearest;
      currentYRef.current = baseY(nearest);
      if (sheetRef.current) {
        sheetRef.current.style.transition = "transform 0.38s var(--ease-spring)";
        sheetRef.current.style.transform = `translate3d(0, ${baseY(nearest)}px, 0)`;
      }
      setSnap(nearest);
    },
    [baseY, dismissOnDrag, onClose],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const st = startRef.current;
      if (!st || e.pointerId !== st.id) return;
      startRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);
      if (sheetRef.current) {
        sheetRef.current.style.transition = "transform 0.38s var(--ease-spring)";
        sheetRef.current.style.transform = `translate3d(0, ${baseY(snapRef.current)}px, 0)`;
      }
    },
    [baseY],
  );

  if (desktop) {
    return (
      <section
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-label={ariaLabel}
        className="surface absolute bottom-3 left-3 top-[116px] z-[1001] flex w-[400px] flex-col overflow-hidden rounded-3xl outline-none animate-rise xl:top-3"
      >
        <div className="shrink-0">{header}</div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3 bg-gradient-to-b from-surface to-transparent"
            aria-hidden
          />
          {children}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sheetRef}
      tabIndex={-1}
      role="dialog"
      aria-label={ariaLabel}
      data-snap={snap}
      className={`surface absolute inset-x-0 bottom-0 z-[1001] flex flex-col overflow-hidden rounded-t-[28px] outline-none border-t border-hairline ${
        isDragging ? "select-none" : ""
      }`}
      style={{
        height: `${FULL * 100}dvh`,
        transform: isDragging
          ? undefined
          : `translate3d(0, ${mounted ? baseY(snap) : FULL * vh()}px, 0)`,
        transition: isDragging ? "none" : "transform 0.38s var(--ease-spring)",
        willChange: isDragging ? "transform" : undefined,
        boxShadow: "var(--shadow-sheet)",
      }}
    >
      <div
        ref={headerRef}
        className="shrink-0 cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ touchAction: "none" }}
      >
        <div className="flex w-full items-center justify-center py-2.5" aria-hidden>
          <div className="h-1.5 w-10 rounded-full bg-white/35 transition-colors hover:bg-white/50 active:bg-white/60" />
        </div>
        {header}
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          touchAction: "pan-y",
          paddingBottom: `${baseY(snap)}px`,
          transition: isDragging ? "none" : "padding-bottom 0.38s var(--ease-spring)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3 bg-gradient-to-b from-surface to-transparent"
          aria-hidden
        />
        {children}
      </div>
    </section>
  );
}
