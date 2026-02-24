"use client";

import { useEffect, useRef } from "react";

export function CursorTrail() {
  const TRAIL_COUNT = 44;
  const trailRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse) return;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    const trail = Array.from({ length: TRAIL_COUNT }, () => ({
      x: targetX,
      y: targetY,
    }));
    let lastMoveAt = 0;
    let visibility = 0;
    let lastFrameAt = performance.now();
    let rafId = 0;

    const onMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      lastMoveAt = performance.now();
    };

    const animate = () => {
      const now = performance.now();
      const dt = Math.max(0, now - lastFrameAt);
      lastFrameAt = now;

      trail[0].x += (targetX - trail[0].x) * 0.35;
      trail[0].y += (targetY - trail[0].y) * 0.35;
      for (let i = 1; i < TRAIL_COUNT; i += 1) {
        trail[i].x += (trail[i - 1].x - trail[i].x) * 0.42;
        trail[i].y += (trail[i - 1].y - trail[i].y) * 0.42;
      }

      for (let i = 0; i < TRAIL_COUNT; i += 1) {
        const el = trailRefs.current[i];
        if (!el) continue;
        el.style.transform = `translate3d(${trail[i].x}px, ${trail[i].y}px, 0)`;
      }
      const moving = now - lastMoveAt < 90;
      if (moving) {
        // Quick fade-in while moving.
        visibility = Math.min(1, visibility + dt / 180);
      } else {
        // Slow fade-out over ~1.5s when idle.
        visibility = Math.max(0, visibility - dt / 1500);
      }
      for (let i = 0; i < TRAIL_COUNT; i += 1) {
        const el = trailRefs.current[i];
        if (!el) continue;
        const alpha = 0.48 * (1 - i / TRAIL_COUNT) * visibility;
        el.style.opacity = `${Math.max(0, Math.min(1, alpha))}`;
      }
      rafId = window.requestAnimationFrame(animate);
    };

    window.addEventListener("mousemove", onMove);
    rafId = window.requestAnimationFrame(animate);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-30">
      {Array.from({ length: TRAIL_COUNT }).map((_, i) => {
        const scale = 1 - i / (TRAIL_COUNT + 4);
        return (
          <div
            key={i}
            ref={(el) => {
              trailRefs.current[i] = el;
            }}
            className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[10px]"
            style={{
              width: `${28 * scale}px`,
              height: `${14 * scale}px`,
              backgroundColor: "rgb(0,196,140)",
              boxShadow: "0 0 28px rgba(0,196,140,0.55)",
              opacity: 0,
            }}
          />
        );
      })}
    </div>
  );
}
