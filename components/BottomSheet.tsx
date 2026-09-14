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

// Physics parameters (fluid iOS/zbiorkom-like spring)
const SPRING_STIFFNESS = 280;
const SPRING_DAMPING = 28;

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
  const rafRef = useRef<number | null>(null);
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

  const vh = () => window.innerHeight;

  /** translateY (px) that leaves the chosen snap showing */
  const baseY = useCallback((s: Snap) => {
    const h = vh();
    if (s === "full") return 0;
    if (s === "half") return (FULL - HALF) * h;
    // peek: ensure at least ~156px is visible (header + delay + badges) on smaller screens
    const peekVisibleH = Math.max(PEEK * h, Math.min(156, FULL * h - 20));
    return FULL * h - peekVisibleH;
  }, []);

  /** Physics-based spring animation to targetY */
  const animateTo = useCallback((targetY: number, initialVelocity = 0, onComplete?: () => void) => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Check reduced motion preference
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      currentYRef.current = targetY;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translate3d(0, ${targetY}px, 0)`;
      }
      onComplete?.();
      return;
    }

    let pos = currentYRef.current;
    let vel = initialVelocity;
    let lastTime = performance.now();

    const step = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.032);
      lastTime = time;

      if (dt > 0) {
        const displacement = pos - targetY;
        const springForce = -SPRING_STIFFNESS * displacement;
        const dampingForce = -SPRING_DAMPING * vel;
        const force = springForce + dampingForce;
        vel += force * dt;
        pos += vel * dt;
      }

      currentYRef.current = pos;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translate3d(0, ${pos}px, 0)`;
      }

      // Settle condition
      if (Math.abs(vel) < 1 && Math.abs(pos - targetY) < 0.5) {
        pos = targetY;
        currentYRef.current = targetY;
        if (sheetRef.current) {
          sheetRef.current.style.transform = `translate3d(0, ${targetY}px, 0)`;
        }
        rafRef.current = null;
        onComplete?.();
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
  }, []);

  // Entrance spring on mount
  useEffect(() => {
    if (desktop) return;
    const h = vh();
    const offscreenY = FULL * h;
    currentYRef.current = offscreenY;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translate3d(0, ${offscreenY}px, 0)`;
    }
    const initialTarget = baseY(initialSnap);
    snapRef.current = initialSnap;

    const raf = requestAnimationFrame(() => {
      setMounted(true);
      animateTo(initialTarget, 0);
    });

    return () => {
      cancelAnimationFrame(raf);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [desktop, initialSnap, baseY, animateTo]);

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

      // Interrupt running animation immediately
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      startRef.current = {
        id: e.pointerId,
        y: e.clientY,
        t: e.timeStamp,
        base: currentYRef.current,
        target: e.target as HTMLElement,
      };
      movesRef.current = [{ y: e.clientY, t: e.timeStamp }];
      isDraggingRef.current = true;
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [desktop],
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
          setSnap(nextSnap);
          animateTo(baseY(nextSnap), 0);
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
        animateTo(FULL * vh(), releaseVel, onClose);
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
      setSnap(nearest);
      animateTo(baseY(nearest), releaseVel);
    },
    [baseY, animateTo, dismissOnDrag, onClose],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const st = startRef.current;
      if (!st || e.pointerId !== st.id) return;
      startRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);
      animateTo(baseY(snapRef.current), 0);
    },
    [baseY, animateTo],
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
        mounted ? "" : "translate-y-full"
      } ${isDragging ? "select-none" : ""}`}
      style={{
        height: `${FULL * 100}dvh`,
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
