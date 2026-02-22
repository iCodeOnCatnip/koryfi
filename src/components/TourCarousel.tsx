"use client";

import { useState, useEffect } from "react";

const SLIDES = ["/tour-1.png", "/tour-2.png", "/tour-3.png"];
const INTERVAL_MS = 3000;

export function TourCarousel() {
  const [current, setCurrent] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setCurrent((i) => (i + 1) % SLIDES.length),
      INTERVAL_MS
    );
    return () => clearInterval(id);
  }, [tick]);

  const go = (dir: 1 | -1) => {
    setCurrent((i) => (i + dir + SLIDES.length) % SLIDES.length);
    setTick((t) => t + 1);
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Sliding strip */}
      <div
        className="flex h-full transition-transform duration-500 ease-in-out"
        style={{
          width: `${SLIDES.length * 100}%`,
          transform: `translateX(-${(current * 100) / SLIDES.length}%)`,
        }}
      >
        {SLIDES.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={`Product tour step ${i + 1}`}
            className="h-full object-cover flex-shrink-0"
            style={{ width: `${100 / SLIDES.length}%` }}
            draggable={false}
          />
        ))}
      </div>

      {/* Arrow navigation — bottom centre */}
      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-4 z-10">
        <button
          onClick={() => go(-1)}
          aria-label="Previous"
          className="w-8 h-8 rounded-full flex items-center justify-center bg-black/40 hover:bg-black/60 border border-primary/20 text-foreground transition-all active:scale-[0.97] cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => { setCurrent(i); setTick((t) => t + 1); }}
            aria-label={`Go to slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
              i === current ? "bg-primary w-4" : "bg-primary/30 w-1.5"
            }`}
          />
        ))}

        <button
          onClick={() => go(1)}
          aria-label="Next"
          className="w-8 h-8 rounded-full flex items-center justify-center bg-black/40 hover:bg-black/60 border border-primary/20 text-foreground transition-all active:scale-[0.97] cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

