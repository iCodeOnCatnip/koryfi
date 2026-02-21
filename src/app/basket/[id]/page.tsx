"use client";

import { use, useState, useEffect, useMemo, useRef } from "react";
import { notFound } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { getBasketById } from "@/lib/baskets/config";
import { SwapPanel } from "@/components/swap/SwapPanel";
import { PerformanceChart } from "@/components/charts/PerformanceChart";
import { usePrices } from "@/hooks/usePrices";
import { getCustomWeights, getPurchaseRecords, savePurchaseRecord } from "@/lib/portfolio/history";
import { WeightMode, PurchaseRecord, BasketConfig } from "@/lib/baskets/types";
import { getSwapPreview, executeBasketBuy } from "@/lib/swap/swapExecutor";
import { DEFAULT_SLIPPAGE_BPS, USDC_MINT } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Per-basket hardcoded custom weight defaults — used for init and "Reset to Default" */
function getDefaultCustomWeights(basketId: string | undefined): Record<string, number> | null {
  if (basketId === "blue-chip") {
    return {
      "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": 50, // BTC
      "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": 30, // ETH
      "So11111111111111111111111111111111111111112": 20,    // SOL
    };
  }
  if (basketId === "global-market") {
    return {
      "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ": 50, // QQQx
      "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P": 30, // XAUT0
      "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": 20, // BTC
    };
  }
  return null;
}

/** Fetch market cap weights via server-side proxy (avoids CORS + rate limits) */
async function fetchMarketCapWeights(
  allocations: { mint: string; coingeckoId: string }[]
): Promise<Record<string, number>> {
  const ids = allocations.map((a) => a.coingeckoId).join(",");
  const res = await fetch(`/api/marketcap?ids=${ids}`);
  if (!res.ok) return {};
  const data: { weights: Record<string, number> } = await res.json();
  // Map coingeckoId weights back to mint addresses
  return Object.fromEntries(
    allocations.map((a) => [a.mint, data.weights[a.coingeckoId] ?? 0])
  );
}

// Pie chart colors matching the allocation bar palette
const PIE_COLORS = ["#10b981", "#4ade80", "#14b8a6", "#84cc16", "#0891b2"];

function PieChart({
  allocations,
  weights,
}: {
  allocations: { symbol: string; mint: string; weight: number; icon: string }[];
  weights?: Record<string, number> | null;
}) {
  const [hoveredMint, setHoveredMint] = useState<string | null>(null);
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 72;
  const hoverRadius = 78;
  const innerRadius = 42;

  // Memoized — only recomputed when allocations or weights change, not on hover
  const sorted = useMemo(
    () => [...allocations].sort((a, b) => (weights?.[b.mint] ?? b.weight) - (weights?.[a.mint] ?? a.weight)),
    [allocations, weights]
  );

  const sliceData = useMemo(() => {
    let cumulativeAngle = -90;
    return sorted.map((alloc, i) => {
      const w = weights?.[alloc.mint] ?? alloc.weight;
      const angle = (w / 100) * 360;
      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + angle;
      cumulativeAngle = endAngle;
      return { alloc, w, startAngle, endAngle, angle, colorIdx: i };
    });
  }, [sorted, weights]);

  const hoveredSlice = hoveredMint ? sliceData.find((s) => s.alloc.mint === hoveredMint) : null;

  return (
    <div className="flex items-center justify-between">
      {/* Pie chart */}
      <div className="relative flex-shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {sliceData.map((s) => {
            const isHovered = hoveredMint === s.alloc.mint;
            const r = isHovered ? hoverRadius : radius;
            const startRad = (s.startAngle * Math.PI) / 180;
            const endRad = (s.endAngle * Math.PI) / 180;

            // Outer arc
            const ox1 = cx + r * Math.cos(startRad);
            const oy1 = cy + r * Math.sin(startRad);
            const ox2 = cx + r * Math.cos(endRad);
            const oy2 = cy + r * Math.sin(endRad);
            // Inner arc
            const ix1 = cx + innerRadius * Math.cos(endRad);
            const iy1 = cy + innerRadius * Math.sin(endRad);
            const ix2 = cx + innerRadius * Math.cos(startRad);
            const iy2 = cy + innerRadius * Math.sin(startRad);

            const largeArc = s.angle > 180 ? 1 : 0;

            const d = [
              `M ${ox1} ${oy1}`,
              `A ${r} ${r} 0 ${largeArc} 1 ${ox2} ${oy2}`,
              `L ${ix1} ${iy1}`,
              `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2}`,
              "Z",
            ].join(" ");

            return (
              <path
                key={s.alloc.mint}
                d={d}
                fill={PIE_COLORS[s.colorIdx % PIE_COLORS.length]}
                opacity={hoveredMint && !isHovered ? 0.4 : 1}
                onMouseEnter={() => setHoveredMint(s.alloc.mint)}
                onMouseLeave={() => setHoveredMint(null)}
                style={{ cursor: "pointer", transition: "opacity 0.15s" }}
              />
            );
          })}
        </svg>

        {/* Center tooltip on hover */}
        {hoveredSlice && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-sm font-bold">{hoveredSlice.alloc.symbol}</div>
              <div className="text-lg font-mono font-bold text-primary">{hoveredSlice.w}%</div>
            </div>
          </div>
        )}
      </div>

      {/* Legend — right aligned */}
      <div className="space-y-2">
        {sorted.map((alloc, i) => {
          const w = weights?.[alloc.mint] ?? alloc.weight;
          const isHovered = hoveredMint === alloc.mint;
          return (
            <div
              key={alloc.mint}
              className={`flex items-center gap-2 px-2 py-1 rounded-md transition-colors cursor-pointer ${isHovered ? "bg-primary/10" : ""}`}
              onMouseEnter={() => setHoveredMint(alloc.mint)}
              onMouseLeave={() => setHoveredMint(null)}
            >
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={alloc.icon} alt={alloc.symbol} className="w-5 h-5 rounded-full" style={{ background: "#fff" }} />
              <span className="text-sm font-medium">{alloc.symbol}</span>
              <span className="text-xs font-mono text-primary">{w}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Transaction History ─────────────────────────────────────────────

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type RedoStatus = "idle" | "quoting" | "signing" | "submitting" | "success" | "error";

function TxHistory({
  walletPubkey,
  basketId,
  basket,
}: {
  walletPubkey: string | null;
  basketId: string;
  basket: BasketConfig;
}) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { prices } = usePrices();

  const [records, setRecords] = useState<PurchaseRecord[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [redoRecord, setRedoRecord] = useState<PurchaseRecord | null>(null);
  const [redoStatus, setRedoStatus] = useState<RedoStatus>("idle");
  const [redoError, setRedoError] = useState<string | null>(null);
  const rebuyInFlight = useRef(false); // sync guard — prevents double-trigger before re-render

  const loadRecords = (pubkey: string) => {
    const all = getPurchaseRecords(pubkey);
    return all.filter((r) => r.basketId === basketId).sort((a, b) => b.timestamp - a.timestamp);
  };

  useEffect(() => {
    if (!walletPubkey) { setRecords([]); return; }
    setRecords(loadRecords(walletPubkey));
  }, [walletPubkey, basketId]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openRedo = (rec: PurchaseRecord) => {
    setRedoRecord(rec);
    setRedoStatus("idle");
    setRedoError(null);
  };

  const closeRedo = () => {
    setRedoRecord(null);
    setRedoStatus("idle");
    setRedoError(null);
  };

  const handleRebuy = async () => {
    if (rebuyInFlight.current) return;
    if (!wallet.publicKey || !wallet.signAllTransactions || !redoRecord) return;
    rebuyInFlight.current = true;
    setRedoStatus("quoting");
    setRedoError(null);
    try {
      const preview = await getSwapPreview(
        basket,
        redoRecord.usdcInvested,
        redoRecord.weights,
        DEFAULT_SLIPPAGE_BPS,
        USDC_MINT
      );
      setRedoStatus("signing");
      const result = await executeBasketBuy(
        connection,
        { publicKey: wallet.publicKey, signAllTransactions: wallet.signAllTransactions },
        preview.quotes,
        preview.totalFeeAmount
      );
      if (result.success) {
        const totalWeight = Object.values(redoRecord.weights).reduce((s, v) => s + v, 0) || 100;
        savePurchaseRecord(wallet.publicKey.toString(), {
          id: crypto.randomUUID(),
          basketId: basket.id,
          timestamp: Date.now(),
          usdcInvested: preview.netInputAmount,
          weights: redoRecord.weights,
          allocations: preview.allocations.map((a) => ({
            mint: a.mint,
            symbol: a.symbol,
            ratio: (redoRecord.weights[a.mint] ?? 0) / totalWeight,
            priceAtPurchase: prices[a.mint] ?? 0,
          })),
          bundleId: result.bundleId || "",
          txSignatures: result.txSignatures || [],
        });
        setRedoStatus("success");
        // Refresh list then close after brief success flash
        setRecords(loadRecords(wallet.publicKey.toString()));
        setTimeout(closeRedo, 1500);
      } else {
        setRedoStatus("error");
        setRedoError(result.error || "Transaction failed");
      }
    } catch (err) {
      setRedoStatus("error");
      setRedoError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      rebuyInFlight.current = false;
    }
  };

  return (
    <>
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {!walletPubkey ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Connect your wallet to view transaction history.
            </p>
          ) : records.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No transactions yet for this basket.
            </p>
          ) : (
            <div className="space-y-3">
              {records.map((rec) => {
                const isOpen = expanded.has(rec.id);
                return (
                  <div key={rec.id} className="rounded-lg border border-primary/10 bg-background overflow-hidden">
                    {/* Row summary */}
                    <div
                      role="button"
                      tabIndex={0}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-primary/5 transition-colors"
                      onClick={() => toggleExpand(rec.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleExpand(rec.id);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <svg
                          width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className={`text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium">
                            ${rec.usdcInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} invested
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDate(rec.timestamp)}</p>
                        </div>
                      </div>
                      {/* Redo button — stops row toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); openRedo(rec); }}
                        className="flex-shrink-0 text-xs px-3 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.97] active:brightness-90 transition-all font-medium"
                      >
                        Repeat investment
                      </button>
                    </div>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-primary/10 pt-3 space-y-3">
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tokens Received</p>
                          {rec.allocations.map((t) => (
                            <div key={t.mint} className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">{t.symbol}</span>
                              <div className="text-right">
                                <span className="font-mono">
                                  {(t.ratio * 100).toFixed(1)}%
                                </span>
                                {t.priceAtPurchase > 0 && (
                                  <span className="text-xs text-muted-foreground ml-2">
                                    @ ${t.priceAtPurchase.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {rec.bundleId && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bundle</p>
                            <a
                              href={`https://explorer.jito.wtf/bundle/${rec.bundleId}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs font-mono text-primary hover:underline break-all"
                            >
                              {rec.bundleId.slice(0, 24)}…
                            </a>
                          </div>
                        )}
                        {rec.txSignatures && rec.txSignatures.length > 1 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transactions</p>
                            <div className="flex flex-wrap gap-2">
                              {rec.txSignatures.slice(1).map((sig, i) => (
                                <a
                                  key={sig}
                                  href={`https://solscan.io/tx/${sig}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-xs font-mono text-primary hover:underline"
                                >
                                  Txn {i + 1} ↗
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rebuy modal */}
      {redoRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="relative w-full max-w-sm rounded-xl border border-primary/20 bg-card p-6 shadow-xl mx-4">
            <button
              onClick={closeRedo}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground active:scale-[0.97] active:brightness-90 transition-all cursor-pointer text-lg leading-none"
            >
              ✕
            </button>

            <h4 className="text-base font-semibold mb-1">Repeat investment</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Reinvest the same amount with the same weights as this transaction.
            </p>

            {/* Details */}
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-mono font-medium">
                  ${redoRecord.usdcInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Original date</span>
                <span className="text-xs font-mono">{formatDate(redoRecord.timestamp)}</span>
              </div>
            </div>

            {/* Weights */}
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-1">Weights</p>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {Object.entries(redoRecord.weights).map(([mint, w]) => {
                  const alloc = basket.allocations.find((a) => a.mint === mint);
                  if (!alloc) return null;
                  return (
                    <div key={mint} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{alloc.symbol}</span>
                      <span className="font-mono">{w}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {redoError && (
              <p className="text-xs text-destructive mb-3">{redoError}</p>
            )}

            {redoStatus === "success" ? (
              <p className="text-sm text-primary font-medium text-center py-2">✓ Investment successful!</p>
            ) : (
              <button
                onClick={handleRebuy}
                disabled={
                  !wallet.publicKey ||
                  !wallet.signAllTransactions ||
                  redoStatus === "quoting" ||
                  redoStatus === "signing" ||
                  redoStatus === "submitting"
                }
                className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 active:scale-[0.97] active:brightness-90 transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {redoStatus === "quoting"
                  ? "Getting quote..."
                  : redoStatus === "signing"
                  ? "Sign transactions..."
                  : redoStatus === "submitting"
                  ? "Submitting..."
                  : "Rebuy"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function BasketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const basket = getBasketById(id);
  const { prices } = usePrices();
  const wallet = useWallet();

  const [weightMode, setWeightMode] = useState<WeightMode>(basket?.defaultWeightMode ?? "equal");

  const defaultCustomWeights = useMemo(
    () => getDefaultCustomWeights(basket?.id),
    [basket?.id]
  );

  const [customWeights, setCustomWeights] = useState<Record<string, number> | null>(
    () => getDefaultCustomWeights(basket?.id)
  );
  const [liveMarketCapWeights, setLiveMarketCapWeights] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (wallet.publicKey && basket) {
      const saved = getCustomWeights(wallet.publicKey.toString(), id);
      if (saved) setCustomWeights(saved);
    }
  }, [wallet.publicKey, id]);

  // Fetch live market cap weights
  useEffect(() => {
    if (!basket) return;
    fetchMarketCapWeights(basket.allocations).then((w) => {
      if (Object.keys(w).length > 0) setLiveMarketCapWeights(w);
    });
  }, [basket?.id]);

  // Resolve active weights based on selected mode
  const activeWeights = useMemo((): Record<string, number> => {
    if (!basket) return {};
    if (weightMode === "marketcap") {
      return liveMarketCapWeights ?? Object.fromEntries(basket.allocations.map((a) => [a.mint, a.marketCapWeight]));
    }
    if (weightMode === "equal") {
      return Object.fromEntries(basket.allocations.map((a) => [a.mint, a.weight]));
    }
    // custom — fall back to basket's default custom weights, then equal weights
    return customWeights ?? defaultCustomWeights ?? Object.fromEntries(basket.allocations.map((a) => [a.mint, a.weight]));
  }, [weightMode, liveMarketCapWeights, customWeights, defaultCustomWeights, basket]);

  if (!basket) {
    notFound();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: Header + Performance Chart */}
      <div className="lg:col-span-2 space-y-6">
        {/* Header */}
        <div>
          <a
            href="/baskets"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mb-4"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Baskets
          </a>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-3xl font-bold">{basket.name}</h2>
            <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
              {basket.allocations.length} assets
            </Badge>
          </div>
          <p className="text-muted-foreground">{basket.description}</p>
        </div>

        {/* Historical Performance Chart */}
        <Card className="border-primary/10 bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Historical Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceChart basket={basket} weights={activeWeights} />
          </CardContent>
        </Card>

        {/* Transaction History */}
        <TxHistory
          walletPubkey={wallet.publicKey?.toString() ?? null}
          basketId={basket.id}
          basket={basket}
        />
      </div>

      {/* Right column: Constituents pie + Invest — merged into one card */}
      <div>
        <Card className="sticky top-24 border-primary/10 bg-card">
          <CardHeader className="pb-3">
            <CardTitle>Invest in {basket.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Pie chart with constituents */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">Constituents</span>
              </div>
              <PieChart
                allocations={basket.allocations}
                weights={activeWeights}
              />
              {/* Current prices */}
              <div className="mt-3 space-y-1">
                {basket.allocations.map((alloc) => {
                  const price = prices[alloc.mint];
                  return (
                    <div key={alloc.mint} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{alloc.symbol}</span>
                      <span className="font-mono">
                        {price
                          ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: price < 1 ? 6 : 2 })}`
                          : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Separator */}
            <div className="border-t border-primary/10" />

            {/* Invest Panel */}
            <SwapPanel
              basket={basket}
              marketCapWeights={liveMarketCapWeights}
              defaultMode={basket.defaultWeightMode}
              weightMode={weightMode}
              onWeightModeChange={setWeightMode}
              customWeights={customWeights}
              onWeightsChange={setCustomWeights}
              defaultCustomWeights={defaultCustomWeights}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
