"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";

export function ConnectButton() {
  const { publicKey, disconnect, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (non-HTTPS or permission denied) — fail silently
    }
  };

  if (connected && publicKey) {
    const addr = publicKey.toString();
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={copyAddress}
          className="text-sm font-mono text-muted-foreground px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 hover:border-primary/50 btn-interactive"
          title="Click to copy address"
        >
          {copied ? "Copied!" : `${addr.slice(0, 4)}...${addr.slice(-4)}`}
        </button>
        <button
          onClick={disconnect}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-red-500/30 hover:border-red-500/70 hover:bg-red-500/10 btn-interactive"
          title="Disconnect wallet"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <Button onClick={() => setVisible(true)} size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
      Connect Wallet
    </Button>
  );
}
