"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";

// Dynamically import Wormhole Connect + routes (heavy, SSR-incompatible)
const WormholeConnect = dynamic(
  () => import("@wormhole-foundation/wormhole-connect"),
  { ssr: false }
);

// We need to build config lazily after dynamic import resolves the routes
// Using a wrapper component to handle the async route imports
function BridgeWidget() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.all([
      import("@wormhole-foundation/wormhole-connect").then((mod) => mod.DEFAULT_ROUTES),
      import("@wormhole-foundation/wormhole-connect/mayan").then((mod) => ({
        MayanRouteSWIFT: mod.MayanRouteSWIFT,
        MayanRouteMCTP: mod.MayanRouteMCTP,
      })),
    ]).then(([defaultRoutes, mayanRoutes]) => {
      setConfig({
        network: "Mainnet",
        chains: ["Ethereum", "Solana", "Polygon", "Bsc", "Arbitrum", "Base"],
        tokens: ["USDC", "USDT", "ETH", "WETH", "SOL"],
        routes: [
          ...defaultRoutes,
          mayanRoutes.MayanRouteSWIFT,
          mayanRoutes.MayanRouteMCTP,
        ],
        ui: {
          title: "",
          defaultInputs: {
            destination: {
              chain: "Solana",
              token: "USDC",
            },
          },
          routeSortPriority: "cheapest",
        },
      });
    }).catch(() => setLoadError(true));
  }, []);

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Failed to load bridge. Please refresh and try again.
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <WormholeConnect config={config} />;
}

export function BridgeFab() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hasOpened = useRef(false);

  const handleOpen = () => {
    if (!hasOpened.current) {
      hasOpened.current = true;
      setLoaded(true);
    }
    setOpen(true);
  };

  return (
    <>
      {/* FAB Button — fixed bottom right */}
      <button
        onClick={handleOpen}
        className="fixed bottom-6 right-6 z-50 h-10 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-lg shadow-primary/25 hover:bg-primary/90 active:scale-[0.97] active:brightness-90 transition-all flex items-center gap-2"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
          <line x1="6" y1="1" x2="6" y2="4" />
          <line x1="10" y1="1" x2="10" y2="4" />
          <line x1="14" y1="1" x2="14" y2="4" />
        </svg>
        Bridge funds to Solana
      </button>

      {/* Bridge Widget Overlay — stays mounted once opened to preserve state */}
      {loaded && (
        <div
          className={`fixed inset-0 z-40 flex items-center justify-center ${
            open ? "" : "pointer-events-none opacity-0"
          }`}
          style={{ transition: "opacity 0.2s" }}
        >
          {/* Backdrop */}
          <div
            className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${open ? "" : "pointer-events-none"}`}
            onClick={() => setOpen(false)}
          />

          {/* Widget Container */}
          <div className="relative z-50 w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl border border-primary/20 bg-background shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-primary/10">
              <h3 className="font-semibold">Bridge to Solana</h3>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-primary/10 active:scale-[0.97] active:brightness-90 flex items-center justify-center transition-all"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Wormhole Connect Widget */}
            <div className="p-2">
              <BridgeWidget />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
