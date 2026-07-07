"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The sheet element is always FULL (88dvh) tall; each snap slides it down so a
 * fraction of it shows: `full` reveals all of it, `half` a balanced split, and
 * `peek` a compact header strip that keeps the map — and the tracked vehicle —
 * in view. Only a deliberate flick below `peek` (or the ✕) dismisses it.
 */
const FULL = 0.88;
const HALF = 0.5;
const PEEK = 0.18;

type Snap = "peek" | "half" | "full";

/** Visible fraction of the viewport at each snap. */
const FRACTION: Record<Snap, number> = { peek: PEEK, half: HALF, full: FULL };
/** Ordered high→low so the nearest-snap search is deterministic. */
const SNAPS: Snap[] = ["full", "half", "peek"];

interface Props {
  onClose: () => void;
  /** md+ — render as a docked left panel instead of a draggable sheet */
  desktop: boolean;
  ariaLabel: string;
  /** header content — on mobile this is the drag zone */
  header: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Mobile: draggable bottom sheet with half/full snap points, velocity-based
 * settle and drag-to-dismiss. Desktop: static panel docked under the search
 * bar. Pure CSS transforms — no animation library.
 */
export default function BottomSheet({ onClose, desktop, ariaLabel, header, children }: Props) {
  const [snap, setSnap] = useState<Snap>("half");
  const [dragY, setDragY] = useState<number | null>(null);
  /* first paint sits at translateY(100%), then transitions up to the snap */
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const start = useRef<{ y: number; t: number; base: number; target: HTMLElement | null } | null>(
    null,
  );
  const lastMove = useRef<{ y: number; t: number } | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* move focus into the sheet on open and restore it to the opener on close, so
     keyboard/screen-reader users aren't stranded on the map behind the panel */
  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    sheetRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  const vh = () => window.innerHeight;
  /** translateY (px) that leaves `FRACTION[s]` of the viewport showing. */
  const baseY = useCallback((s: Snap) => (FULL - FRACTION[s]) * vh(), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (desktop) return;
      // Never start a drag (or capture the pointer) on an interactive control in
      // the header — ✕, back, tabs. Capturing here retargets the follow-up click
      // to this wrapper on touch engines, so those buttons would appear dead.
      if ((e.target as HTMLElement).closest?.("button,a,input")) return;
      start.current = {
        y: e.clientY,
        t: e.timeStamp,
        base: baseY(snap),
        target: e.target as HTMLElement,
      };
      lastMove.current = { y: e.clientY, t: e.timeStamp };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [desktop, snap, baseY],
  );

  /* a system-initiated cancel (gesture nav, call overlay) must NOT run the
     velocity/dismiss projection — just abandon the drag and settle back */
  const onPointerCancel = useCallback(() => {
    start.current = null;
    lastMove.current = null;
    setDragY(null);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    lastMove.current = { y: e.clientY, t: e.timeStamp };
    const dy = e.clientY - start.current.y;
    let y = start.current.base + dy;
    if (y < 0) y = y * 0.25; // resistance above full
    setDragY(y);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const st = start.current;
      start.current = null;
      if (st == null) {
        setDragY(null);
        return;
      }
      const h = vh();
      const moved = Math.abs(e.clientY - st.y);
      /* a tap (barely moved, quick) on the collapsed strip expands it — but a
         tap on a control inside the header still runs that control */
      if (moved < 6 && e.timeStamp - st.t < 250) {
        setDragY(null);
        if (snap === "peek" && !st.target?.closest?.("button,a,input")) setSnap("half");
        return;
      }
      /* project position 180 ms ahead using release velocity, then settle to
         the nearest snap — or dismiss on a decisive drag past `peek` */
      const cur = dragY ?? st.base;
      const lm = lastMove.current;
      const dt = lm ? Math.max(1, e.timeStamp - lm.t) : 1;
      const vel = lm ? (e.clientY - lm.y) / dt : 0;
      const projected = cur + vel * 180;
      const peekY = baseY("peek");
      if (projected > peekY + PEEK * h * 0.5) {
        setDragY(null);
        onClose();
        return;
      }
      let nearest: Snap = "half";
      let best = Infinity;
      for (const s of SNAPS) {
        const d = Math.abs(projected - baseY(s));
        if (d < best) {
          best = d;
          nearest = s;
        }
      }
      setSnap(nearest);
      setDragY(null);
    },
    [dragY, snap, onClose, baseY],
  );

  if (desktop) {
    // Docked left rail. Pull flush to the top (top-3) on wide screens where the
    // centred search bar clears the panel; keep a small clearance below xl so the
    // search bar never overlaps the panel header (and its ✕) on narrow desktops.
    return (
      <section
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-label={ariaLabel}
        className="surface absolute bottom-3 left-3 top-[116px] z-[1001] flex w-[400px] flex-col overflow-hidden rounded-3xl outline-none animate-rise xl:top-3"
      >
        <div className="shrink-0">{header}</div>
        {children}
      </section>
    );
  }

  const y = dragY ?? baseY(snap);
  return (
    <section
      ref={sheetRef}
      tabIndex={-1}
      role="dialog"
      aria-label={ariaLabel}
      className="surface absolute inset-x-0 bottom-0 z-[1001] flex flex-col overflow-hidden rounded-t-[28px] outline-none"
      style={{
        height: `${FULL * 100}dvh`,
        transform: entered ? `translateY(${y}px)` : "translateY(100%)",
        transition: dragY != null ? "none" : "transform 0.42s var(--ease-spring)",
        boxShadow: "var(--shadow-sheet)",
      }}
    >
      <div
        className="shrink-0 cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ touchAction: "none" }}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-white/25" aria-hidden />
        {header}
      </div>
      <div className="min-h-0 flex-1" style={{ touchAction: "pan-y" }}>
        {children}
      </div>
    </section>
  );
}
