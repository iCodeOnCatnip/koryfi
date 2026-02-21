"use client";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BASKETS } from "@/lib/baskets/config";
import { usePrices } from "@/hooks/usePrices";
import { getPurchaseRecords } from "@/lib/portfolio/history";
import { PurchaseRecord } from "@/lib/baskets/types";
import { executeBasketSell } from "@/lib/swap/swapExecutor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// Lookup basket display name from config
const BASKET_NAME: Record<string, string> = Object.fromEntries(
  BASKETS.map((b) => [b.id, b.name])
);

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function PurchaseHistoryList({ records }: { records: PurchaseRecord[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No transactions yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((rec) => {
        const isOpen = expanded.has(rec.id);
        return (
          <div key={rec.id} className="rounded-lg border border-primary/10 bg-background overflow-hidden">
            {/* Summary row */}
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-primary/5 transition-colors"
              onClick={() => toggle(rec.id)}
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
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      ${rec.usdcInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} invested
                    </p>
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-0 text-xs">
                      {BASKET_NAME[rec.basketId] ?? rec.basketId}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(rec.timestamp)}</p>
                </div>
              </div>
              <Badge variant="secondary" className="bg-primary/10 text-primary border-0 text-xs flex-shrink-0">
                {rec.allocations.length} tokens
              </Badge>
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div className="px-4 pb-4 border-t border-primary/10 pt-3 space-y-3">
                {/* Tokens received */}
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

                {/* Bundle link */}
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

                {/* Tx links — skip first (fee tx) */}
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
  );
}

interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
  valueUsd: number;
}

export default function PortfolioPage() {
  const { publicKey, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { prices } = usePrices();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState(false);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);

    const allTokens = BASKETS.flatMap((b) => b.allocations);
    const uniqueTokens = Array.from(
      new Map(allTokens.map((t) => [t.mint, t])).values()
    );

    const results: TokenBalance[] = [];

    for (const token of uniqueTokens) {
      try {
        // SOL native balance
        if (token.mint === "So11111111111111111111111111111111111111112") {
          const bal = await connection.getBalance(publicKey);
          const solAmount = bal / 1e9;
          results.push({
            mint: token.mint,
            symbol: token.symbol,
            balance: solAmount,
            decimals: token.decimals,
            valueUsd: solAmount * (prices[token.mint] || 0),
          });
          continue;
        }

        const ata = getAssociatedTokenAddressSync(
          new PublicKey(token.mint),
          publicKey
        );
        const accountInfo = await connection.getTokenAccountBalance(ata);
        const amount =
          Number(accountInfo.value.amount) / 10 ** token.decimals;
        results.push({
          mint: token.mint,
          symbol: token.symbol,
          balance: amount,
          decimals: token.decimals,
          valueUsd: amount * (prices[token.mint] || 0),
        });
      } catch {
        // Token account doesn't exist — balance is 0
        results.push({
          mint: token.mint,
          symbol: token.symbol,
          balance: 0,
          decimals: token.decimals,
          valueUsd: 0,
        });
      }
    }

    setBalances(results);
    setLoading(false);
  }, [publicKey, connection, prices]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const totalValue = balances.reduce((s, b) => s + b.valueUsd, 0);
  const records = publicKey ? getPurchaseRecords(publicKey.toString()) : [];
  const totalInvested = records.reduce((s, r) => s + r.usdcInvested, 0);
  const pnl = totalValue - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

  const handleSellAll = useCallback(async () => {
    if (!publicKey || !signAllTransactions) return;
    setSelling(true);

    const sellAmounts = balances
      .filter((b) => b.balance > 0 && b.mint !== "So11111111111111111111111111111111111111112")
      .map((b) => ({
        inputMint: b.mint,
        amount: Math.floor(b.balance * 10 ** b.decimals).toString(),
      }));

    if (sellAmounts.length === 0) {
      setSelling(false);
      return;
    }

    try {
      const result = await executeBasketSell(
        connection,
        { publicKey, signAllTransactions },
        sellAmounts
      );

      if (result.success) {
        alert("Sell successful! USDC returned to your wallet.");
        fetchBalances();
      } else {
        alert(`Sell failed: ${result.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSelling(false);
    }
  }, [publicKey, signAllTransactions, balances, connection, fetchBalances]);

  if (!publicKey) {
    return (
      <div className="text-center py-20 space-y-4">
        <h2 className="text-2xl font-bold">Portfolio</h2>
        <p className="text-muted-foreground">
          Connect your wallet to view your basket positions.
        </p>
        <Button onClick={() => setVisible(true)}>Connect Wallet</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold">Portfolio</h2>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Invested
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              ${totalInvested.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              PnL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-mono ${
                pnl >= 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              {pnl >= 0 ? "+" : ""}
              ${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              <span className="text-sm ml-1">
                ({pnlPct >= 0 ? "+" : ""}
                {pnlPct.toFixed(2)}%)
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Holdings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Holdings</CardTitle>
          <Button
            variant="destructive"
            size="sm"
            disabled={selling || balances.every((b) => b.balance === 0)}
            onClick={handleSellAll}
          >
            {selling ? "Selling..." : "Sell All → USDC"}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {balances.map((b) => (
                <div key={b.mint}>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <span className="font-medium">{b.symbol}</span>
                      <span className="text-sm text-muted-foreground ml-2 font-mono">
                        {b.balance.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </span>
                    </div>
                    <div className="text-right font-mono">
                      ${b.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <Separator />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Purchase History */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <PurchaseHistoryList
            records={records.slice().sort((a, b) => b.timestamp - a.timestamp)}
          />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Portfolio values reflect current wallet holdings and may differ if tokens were moved externally.
      </p>
    </div>
  );
}
