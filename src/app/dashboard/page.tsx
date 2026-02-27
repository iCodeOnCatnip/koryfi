"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  getPurchaseRecords,
  getPurchaseRecordsSynced,
  getVisibleSwapSignatures,
} from "@/lib/portfolio/history";
import { BASKETS, getBasketById } from "@/lib/baskets/config";
import { PurchaseRecord } from "@/lib/baskets/types";
import { usePrices } from "@/hooks/usePrices";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PIE_COLORS = ["#10b981", "#14b8a6", "#4ade80", "#84cc16", "#0891b2", "#8b5cf6", "#f59e0b"];

// â”€â”€ Formatters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmtUsd(v: number) {
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface BasketPosition {
  basketId: string;
  name: string;
  totalInvestedUsd: number;
  currentValueUsd: number;
}

// â”€â”€ Computation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function computeBasketPositions(
  records: PurchaseRecord[],
  prices: Record<string, number>
): BasketPosition[] {
  const map = new Map<string, { invested: number; currentValue: number }>();
  for (const rec of records) {
    const entry = map.get(rec.basketId) ?? { invested: 0, currentValue: 0 };
    entry.invested += rec.usdcInvested;
    for (const alloc of rec.allocations) {
      if (alloc.priceAtPurchase > 0) {
        const qty = (rec.usdcInvested * alloc.ratio) / alloc.priceAtPurchase;
        // Fall back to purchase price if live price not yet loaded (prevents 0 value on load)
        entry.currentValue += qty * (prices[alloc.mint] ?? alloc.priceAtPurchase);
      }
    }
    map.set(rec.basketId, entry);
  }
  return Array.from(map.entries()).map(([basketId, { invested, currentValue }]) => ({
    basketId,
    name: getBasketById(basketId)?.name ?? basketId,
    totalInvestedUsd: invested,
    currentValueUsd: currentValue,
  }));
}

// â”€â”€ SVG Pie Chart (same pattern as basket page) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DashboardPieChart({ positions }: { positions: BasketPosition[] }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const total = positions.reduce((s, p) => s + p.currentValueUsd, 0);
  const filtered = positions.filter((p) => p.currentValueUsd > 0);

  const size = 200, cx = 100, cy = 100, r = 80, rHover = 86, inner = 48;

  const sliceData = useMemo(() => {
    let angle = -90;
    return filtered.map((p, i) => {
      const pct = p.currentValueUsd / total;
      const sweep = pct * 360;
      const start = angle;
      angle += sweep;
      return { p, pct, start, end: angle, sweep, i };
    });
  }, [filtered, total]);

  const hoveredSlice = hoveredId ? sliceData.find((s) => s.p.basketId === hoveredId) : null;

  if (!filtered.length) {
    return (
      <div className="flex items-center justify-center h-full min-h-[220px]">
        <p className="text-sm text-muted-foreground">No portfolio data yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative flex-shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {sliceData.map((s) => {
            const isHovered = hoveredId === s.p.basketId;
            const radius = isHovered ? rHover : r;
            const toRad = (deg: number) => (deg * Math.PI) / 180;
            const x1 = cx + radius * Math.cos(toRad(s.start));
            const y1 = cy + radius * Math.sin(toRad(s.start));
            const x2 = cx + radius * Math.cos(toRad(s.end));
            const y2 = cy + radius * Math.sin(toRad(s.end));
            const ix1 = cx + inner * Math.cos(toRad(s.end));
            const iy1 = cy + inner * Math.sin(toRad(s.end));
            const ix2 = cx + inner * Math.cos(toRad(s.start));
            const iy2 = cy + inner * Math.sin(toRad(s.start));
            const large = s.sweep > 180 ? 1 : 0;
            const d = `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix2} ${iy2} Z`;
            return (
              <path
                key={s.p.basketId}
                d={d}
                fill={PIE_COLORS[s.i % PIE_COLORS.length]}
                opacity={hoveredId && !isHovered ? 0.35 : 1}
                style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                onMouseEnter={() => setHoveredId(s.p.basketId)}
                onMouseLeave={() => setHoveredId(null)}
              />
            );
          })}
        </svg>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {hoveredSlice ? (
            <div className="text-center">
              <div className="text-xs font-medium text-muted-foreground">{hoveredSlice.p.name}</div>
              <div className="text-base font-mono font-bold text-primary">
                {(hoveredSlice.pct * 100).toFixed(1)}%
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-sm font-mono font-semibold">{fmtUsd(total)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Legend + tooltip */}
      <div className="flex-1 space-y-2 min-w-0">
        {sliceData.map((s) => {
          const isHovered = hoveredId === s.p.basketId;
          return (
            <div
              key={s.p.basketId}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isHovered ? "bg-primary/10" : "hover:bg-primary/5"}`}
              onMouseEnter={() => setHoveredId(s.p.basketId)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[s.i % PIE_COLORS.length] }} />
                <span className="text-sm truncate">{s.p.name}</span>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs font-mono text-primary">{(s.pct * 100).toFixed(1)}%</div>
                {isHovered && (
                  <div className="text-xs text-muted-foreground font-mono">
                    {fmtUsd(s.p.currentValueUsd)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// â”€â”€ Portfolio Metrics Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PortfolioMetricsCard({
  investedValue,
  currentValue,
  walletUsdValue,
  balancesError,
}: {
  investedValue: number;
  currentValue: number;
  walletUsdValue: number | null;
  balancesError: boolean;
}) {
  const pnl = currentValue - investedValue;
  const pnlPct = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
  const positive = pnl >= 0;

  return (
    <Card className="border-primary/10 bg-card h-full flex flex-col">
      <CardContent className="pt-8 pb-6 px-6 flex flex-col flex-1 gap-10">
        {/* Secondary metrics */}
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">Invested</p>
            <p className="text-4xl md:text-5xl font-mono font-semibold leading-none text-foreground">{fmtUsd(investedValue)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">Current</p>
            <p className="text-4xl md:text-5xl font-mono font-semibold leading-none text-primary">{fmtUsd(currentValue)}</p>
            {investedValue > 0 && (
              <p className={`text-sm font-mono mt-2 ${positive ? "text-primary" : "text-red-400"}`}>
                {positive ? "+" : ""}{fmtUsd(pnl)} ({positive ? "+" : ""}{pnlPct.toFixed(2)}%)
              </p>
            )}
          </div>
        </div>

        {/* Primary metric */}
        <div className="border-t border-primary/10 pt-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Wallet Balance</p>
          <p className="text-2xl md:text-3xl font-mono font-semibold text-muted-foreground leading-none">
            {balancesError
              ? <span className="text-red-400 text-lg">Unable to load</span>
              : walletUsdValue !== null
                ? fmtUsd(walletUsdValue)
                : <span className="text-muted-foreground text-2xl">Loading...</span>
            }
          </p>
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground/50 leading-relaxed mt-auto">
          Wallet Balance is based on your current on-chain balances. Current Value represents what your portfolio would be worth if the basket assets were still held.
        </p>
      </CardContent>
    </Card>
  );
}


function InvestmentTransactionsHistory({ records }: { records: PurchaseRecord[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.timestamp - a.timestamp),
    [records]
  );

  if (sortedRecords.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Transaction History</h2>
        <div className="text-center py-16 border border-primary/10 rounded-2xl bg-card">
          <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <path d="M12 8v4l3 3" />
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>
          <p className="text-muted-foreground">No transactions yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Invest in a basket to see your history here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Transaction History</h2>

      <div className="space-y-3">
        {sortedRecords.map((record) => {
          const isExpanded = expandedId === record.id;
          const basket = BASKETS.find((b) => b.id === record.basketId);
          const date = new Date(record.timestamp);
          const visibleSignatures = getVisibleSwapSignatures(record);
          const hasTxSignatures = visibleSignatures.length > 0;
          const hasBundleId = record.bundleId && record.bundleId.length > 0;

          return (
            <div
              key={record.id}
              className="border border-primary/10 rounded-xl bg-card overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : record.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>

                  <div>
                    <div className="font-medium">
                      {basket?.name || record.basketId}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {date.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      at{" "}
                      {date.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-mono font-medium">
                      ${record.usdcInvested.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {record.allocations.length} tokens
                    </div>
                  </div>

                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-muted-foreground transition-transform duration-200 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-primary/10 px-4 py-3 space-y-3 bg-primary/[0.02]">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Tokens Received
                    </div>
                    {record.allocations.map((token) => {
                      const tokenConfig = basket?.allocations.find(
                        (a) => a.mint === token.mint
                      );
                      return (
                        <div
                          key={token.mint}
                          className="flex items-center justify-between text-sm py-1"
                        >
                          <div className="flex items-center gap-2">
                            {tokenConfig?.icon && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={tokenConfig.icon}
                                alt={token.symbol}
                                className="w-5 h-5 rounded-full"
                              />
                            )}
                            <span>{token.symbol}</span>
                          </div>
                          <div className="text-right font-mono text-sm">
                            <span>
                              {(token.ratio * 100).toFixed(1)}% (${(record.usdcInvested * token.ratio).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })})
                            </span>
                            {token.priceAtPurchase > 0 && (
                              <span className="text-muted-foreground ml-2">
                                @ ${token.priceAtPurchase.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(hasTxSignatures || hasBundleId) && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Transactions
                      </div>

                      {hasBundleId && (
                        <a
                          href={`https://explorer.jito.wtf/bundle/${record.bundleId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between text-sm py-1 px-2 rounded-lg hover:bg-primary/5 transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            <span className="text-muted-foreground">Jito Bundle</span>
                          </div>
                          <span className="font-mono text-xs text-muted-foreground group-hover:text-primary transition-colors">
                            {record.bundleId.slice(0, 12)}...
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline ml-1">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </span>
                        </a>
                      )}

                      {hasTxSignatures &&
                        visibleSignatures.map((sig, i) => (
                          <a
                            key={sig}
                            href={`https://solscan.io/tx/${sig}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between text-sm py-1 px-2 rounded-lg hover:bg-primary/5 transition-colors group"
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                              <span className="text-muted-foreground">Swap {i + 1}</span>
                            </div>
                            <span className="font-mono text-xs text-muted-foreground group-hover:text-primary transition-colors">
                              {sig.slice(0, 12)}...
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline ml-1">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </span>
                          </a>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DepositHistoryTab() {
  const headers = ["Date", "Source Chain", "Amount", "Route", "Status", "Tx"];
  return (
    <div className="relative rounded-xl border border-primary/10 overflow-hidden">
      {/* Blurred table */}
      <div className="blur-sm pointer-events-none select-none">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary/10" style={{ background: "rgba(0,196,140,0.04)" }}>
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(4)].map((_, i) => (
              <tr key={i} className="border-b border-primary/5">
                {headers.map((h) => (
                  <td key={h} className="px-4 py-3">
                    <div className="h-3 rounded bg-primary/10 w-16" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <p className="text-sm font-medium text-foreground">Multichain management coming soon</p>
        <p className="text-xs text-muted-foreground">Deposit history across chains will appear here</p>
      </div>
    </div>
  );
}

// â”€â”€ Dashboard Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function DashboardPage() {
  const wallet = useWallet();
  const { prices } = usePrices();

  const [records, setRecords] = useState<PurchaseRecord[]>([]);
  const [walletUsdValue, setWalletUsdValue] = useState<number | null>(null);
  const [balancesError, setBalancesError] = useState(false);
  const [historyTab, setHistoryTab] = useState<"investment" | "deposit">("investment");
  const [historyPanelHeight, setHistoryPanelHeight] = useState<number | null>(null);
  const investmentPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!wallet.publicKey) { setRecords([]); return; }
    const walletKey = wallet.publicKey.toString();
    setRecords(getPurchaseRecords(walletKey));
    let cancelled = false;
    void getPurchaseRecordsSynced(walletKey).then((synced) => {
      if (!cancelled) setRecords(synced);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet.publicKey]);

  useEffect(() => {
    if (!wallet.publicKey) { setWalletUsdValue(null); setBalancesError(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    fetch(`/api/balances?address=${wallet.publicKey.toString()}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { totalUsdValue: number }) => {
        if (!cancelled) { setWalletUsdValue(data.totalUsdValue ?? 0); setBalancesError(false); }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err?.name !== "AbortError") console.error("[balances]", err);
          setBalancesError(err?.name !== "AbortError");
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [wallet.publicKey]);

  const basketPositions = useMemo(
    () => computeBasketPositions(records, prices),
    [records, prices]
  );
  const investedValue = useMemo(() => basketPositions.reduce((s, b) => s + b.totalInvestedUsd, 0), [basketPositions]);
  const currentValue = useMemo(() => basketPositions.reduce((s, b) => s + b.currentValueUsd, 0), [basketPositions]);

  if (!wallet.publicKey) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">Connect your wallet</p>
          <p className="text-sm text-muted-foreground">Your portfolio dashboard will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">Portfolio overview</p>
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PortfolioMetricsCard
          investedValue={investedValue}
          currentValue={currentValue}
          walletUsdValue={walletUsdValue}
          balancesError={balancesError}
        />
        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
              Current Value by Basket
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <DashboardPieChart positions={basketPositions} />
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <div className="space-y-10">
        <h2 className="text-xl font-semibold tracking-tight">History</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (historyTab === "investment") return;
              setHistoryTab("investment");
              setHistoryPanelHeight(null);
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all active:scale-[0.97] active:brightness-90 cursor-pointer ${
              historyTab === "investment"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-primary/20 text-muted-foreground hover:border-primary/50"
            }`}
          >
            Investment
          </button>
          <button
            onClick={() => {
              if (historyTab === "deposit") return;
              const h = investmentPanelRef.current?.offsetHeight ?? null;
              setHistoryPanelHeight(h);
              setHistoryTab("deposit");
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all active:scale-[0.97] active:brightness-90 cursor-pointer ${
              historyTab === "deposit"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-primary/20 text-muted-foreground hover:border-primary/50"
            }`}
          >
            Deposit
          </button>
        </div>
        <div
          style={
            historyTab === "deposit" && historyPanelHeight
              ? { height: `${historyPanelHeight}px`, overflow: "hidden" }
              : undefined
          }
        >
          {historyTab === "investment" ? (
            <div ref={investmentPanelRef}>
              <InvestmentTransactionsHistory records={records} />
            </div>
          ) : (
            <DepositHistoryTab />
          )}
        </div>
      </div>
    </div>
  );
}

