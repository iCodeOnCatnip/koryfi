"use client";

import { useMemo, ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";

import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );
  const endpoint = useMemo(() => {
    // Connection expects absolute URL (http/https); build one for client proxy path.
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/solana-rpc`;
    }
    // SSR/prerender fallback to keep build stable.
    return "https://api.mainnet-beta.solana.com";
  }, []);

  const config = useMemo(
    () => ({
      commitment: "confirmed" as const,
      // Keep WS on a real Solana RPC endpoint. The local HTTP proxy does not expose Solana WS.
      wsEndpoint: "wss://api.mainnet-beta.solana.com",
    }),
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
