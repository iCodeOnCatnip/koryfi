"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { BASKETS, getBasketById } from "@/lib/baskets/config";
import { PurchaseRecord } from "@/lib/baskets/types";
import { getPurchaseRecords, savePurchaseRecord } from "@/lib/portfolio/history";
import { getSwapPreview, executeBasketBuy } from "@/lib/swap/swapExecutor";
import { DEFAULT_SLIPPAGE_BPS, USDC_MINT } from "@/lib/constants";
import { BasketCard } from "@/components/baskets/BasketCard";
import { usePrices } from "@/hooks/usePrices";
import { BridgeFab } from "@/components/bridge/BridgeFab";

export default function Home() {
  const { prices, loading } = usePrices();
  const wallet = useWallet();
  const { connection } = useConnection();
  const router = useRouter();

  const [lastPurchase, setLastPurchase] = useState<PurchaseRecord | null>(null);
  const [showRedoModal, setShowRedoModal] = useState(false);
  const [redoStatus, setRedoStatus] = useState<
    "idle" | "quoting" | "signing" | "submitting" | "success" | "error"
  >("idle");
  const [redoError, setRedoError] = useState<string | null>(null);

  // Load last purchase for the connected wallet (if any)
  useEffect(() => {
    if (!wallet.publicKey) {
      setLastPurchase(null);
      return;
    }
    const records = getPurchaseRecords(wallet.publicKey.toString());
    if (!records.length) {
      setLastPurchase(null);
      return;
    }
    const latest = records[records.length - 1];
    setLastPurchase(latest);
  }, [wallet.publicKey]);

  const lastBasket = useMemo(
    () => (lastPurchase ? getBasketById(lastPurchase.basketId) : undefined),
    [lastPurchase]
  );

  return (
    <div className="space-y-10">
      {/* Tutorial / How It Works Banner */}
      <div
        className="relative px-6 py-5 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, rgba(0,196,140,0.10), rgba(0,196,140,0.02))",
          border: "1px solid #1F2A22",
          borderRadius: "16px",
        }}
      >
        <h2 className="text-lg font-semibold mb-1" style={{ color: "#E6F2ED" }}>
          Invest in Crypto Baskets
        </h2>
        <p className="text-sm mb-4" style={{ color: "#9FB8AD" }}>
          Diversify your portfolio with curated on-chain index funds — all tokens go directly to your wallet.
        </p>
        <div className="flex items-center gap-6">
          {[
            { n: 1, label: "Choose a basket" },
            { n: 2, label: "USDC is split into weighted swaps" },
            { n: 3, label: "Tokens land in your wallet" },
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold"
                style={{
                  background: "rgba(0,196,140,0.12)",
                  border: "1px solid #00C48C",
                  color: "#00C48C",
                }}
              >
                {n}
              </div>
              <span className="text-xs" style={{ color: "#9FB8AD" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Available Baskets + redo last buy */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-muted-foreground">
            Available Baskets
          </h3>
          {wallet.publicKey && lastPurchase && lastBasket && (
            <button
              type="button"
              onClick={() => setShowRedoModal(true)}
              className="text-xs md:text-sm px-3 py-1.5 rounded-md bg-[#00C48C] text-black hover:opacity-90 active:scale-[0.97] active:brightness-90 transition-all cursor-pointer"
            >
              Repeat last investment
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-52 rounded-xl border border-primary/10 bg-card animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {BASKETS.map((basket) => (
              <BasketCard key={basket.id} basket={basket} prices={prices} />
            ))}
          </div>
        )}
      </div>

      {/* Bridge FAB (fixed bottom-right) */}
      <BridgeFab />

      {/* Redo Last Buy Modal */}
      {showRedoModal && lastPurchase && lastBasket && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className="relative w-full max-w-md rounded-xl border border-primary/20 bg-card p-6 shadow-xl">
            <button
              type="button"
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground active:scale-[0.97] active:brightness-90 transition-all cursor-pointer"
              onClick={() => setShowRedoModal(false)}
            >
              ✕
            </button>
            <h4 className="text-lg font-semibold mb-2">Redo your last buy</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Review the details of your most recent basket purchase. You can jump
              back to this basket and reuse the same configuration.
            </p>

            <div className="space-y-2 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Basket</span>
                <span className="font-medium">{lastBasket.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount invested</span>
                <span className="font-mono">
                  {lastPurchase.usdcInvested.toFixed(2)} USDC
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">When</span>
                <span className="text-xs font-mono">
                  {new Date(lastPurchase.timestamp).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <span className="text-xs text-muted-foreground">Weights used</span>
              <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                {Object.entries(lastPurchase.weights).map(([mint, w]) => {
                  const alloc = lastBasket.allocations.find((a) => a.mint === mint);
                  if (!alloc) return null;
                  return (
                    <div key={mint} className="flex items-center justify-between">
                      <span>{alloc.symbol}</span>
                      <span className="font-mono">{w}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {redoError && (
              <p className="text-xs text-destructive mb-2">
                {redoError}
              </p>
            )}

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                className="flex-1 rounded-md bg-[#00C48C] text-black py-2 text-sm font-medium hover:opacity-90 active:scale-[0.97] active:brightness-90 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={
                  !wallet.publicKey ||
                  !wallet.signAllTransactions ||
                  redoStatus === "quoting" ||
                  redoStatus === "signing" ||
                  redoStatus === "submitting"
                }
                onClick={async () => {
                  if (!wallet.publicKey || !wallet.signAllTransactions) return;
                  setRedoStatus("quoting");
                  setRedoError(null);
                  try {
                    const preview = await getSwapPreview(
                      lastBasket,
                      lastPurchase.usdcInvested,
                      lastPurchase.weights,
                      DEFAULT_SLIPPAGE_BPS,
                      USDC_MINT
                    );
                    setRedoStatus("signing");
                    const result = await executeBasketBuy(
                      connection,
                      {
                        publicKey: wallet.publicKey,
                        signAllTransactions: wallet.signAllTransactions,
                      },
                      preview.quotes,
                      preview.totalFeeAmount
                    );
                    if (result.success) {
                      const totalWeight = Object.values(lastPurchase.weights).reduce((s, v) => s + v, 0) || 100;
                      savePurchaseRecord(wallet.publicKey.toString(), {
                        id: crypto.randomUUID(),
                        basketId: lastBasket.id,
                        timestamp: Date.now(),
                        usdcInvested: preview.netInputAmount,
                        weights: lastPurchase.weights,
                        allocations: preview.allocations.map((a) => ({
                          mint: a.mint,
                          symbol: a.symbol,
                          ratio: (lastPurchase.weights[a.mint] ?? 0) / totalWeight,
                          priceAtPurchase: prices[a.mint] ?? 0,
                        })),
                        bundleId: result.bundleId || "",
                        txSignatures: result.txSignatures || [],
                      });
                      setRedoStatus("success");
                      setShowRedoModal(false);
                    } else {
                      setRedoStatus("error");
                      setRedoError(result.error || "Transaction failed");
                    }
                  } catch (err) {
                    setRedoStatus("error");
                    setRedoError(
                      err instanceof Error
                        ? err.message
                        : "Failed to redo last buy"
                    );
                  }
                }}
              >
                {redoStatus === "quoting"
                  ? "Preparing quote..."
                  : redoStatus === "signing"
                  ? "Signing transactions..."
                  : redoStatus === "submitting"
                  ? "Submitting..."
                  : "Confirm and invest"}
              </button>

              <button
                type="button"
                className="flex-1 rounded-md border border-primary/40 text-primary py-2 text-sm font-medium hover:bg-primary/10 active:scale-[0.97] active:brightness-90 transition-all cursor-pointer"
                onClick={() => {
                  setShowRedoModal(false);
                  router.push(`/basket/${lastBasket.id}`);
                }}
              >
                Go to basket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
