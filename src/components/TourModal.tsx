"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TourCarousel } from "@/components/TourCarousel";

export function TourModal({ ready = true }: { ready?: boolean }) {
  const [open, setOpen] = useState(false);
  const shouldOpen = useRef(false);

  // On mount: check sessionStorage for the tour flag and clear it immediately
  useEffect(() => {
    if (sessionStorage.getItem("openTour") === "1") {
      sessionStorage.removeItem("openTour");
      shouldOpen.current = true;
    }
  }, []);

  // Open once the page data is ready
  useEffect(() => {
    if (!shouldOpen.current || !ready) return;
    const id = setTimeout(() => setOpen(true), 300);
    return () => clearTimeout(id);
  }, [ready]);

  if (!open || typeof document === "undefined") return null;

  // Portal to document.body bypasses all stacking contexts in <main>
  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-6">
      {/* Solid dark overlay */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={() => setOpen(false)}
      />

      {/* Modal card — 2:1 ratio (2800x1400) */}
      <div className="relative z-10 w-[min(99.5vw,1760px)] aspect-[2/1] overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-2xl shadow-black/40">
        {/* Close button */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close tour"
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-lg flex items-center justify-center bg-black/40 hover:bg-black/60 border border-primary/20 text-foreground transition-all active:scale-[0.97] cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <TourCarousel />
      </div>
    </div>,
    document.body
  );
}
