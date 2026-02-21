"use client";

import { Buffer } from "buffer";
if (typeof window !== "undefined") {
  // Polyfill Buffer for Solana wallet adapter
  window.Buffer = window.Buffer || Buffer;
}

import { ReactNode } from "react";
import { SolanaProvider } from "@/providers/SolanaProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SolanaProvider>
      {children}
    </SolanaProvider>
  );
}
