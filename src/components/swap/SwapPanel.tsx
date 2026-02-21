"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { BasketConfig, WeightMode } from "@/lib/baskets/types";
import { useSwapPreview } from "@/hooks/useSwapPreview";
import { executeBasketBuy } from "@/lib/swap/swapExecutor";
import { USDC_MINT, USDT_MINT, WSOL_MINT } from "@/lib/constants";
import { savePurchaseRecord, saveCustomWeights, clearCustomWeights } from "@/lib/portfolio/history";
import { usePrices } from "@/hooks/usePrices";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";

type SwapStatus = "idle" | "previewing" | "signing" | "submitting" | "success" | "error";

type InputAssetKey = "USDC" | "USDT" | "SOL";

// Static — never changes, no need to recreate inside the component
const INPUT_ASSETS: { key: InputAssetKey; label: string; icon: string }[] = [
  { key: "USDC", label: "USDC", icon: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png" },
  { key: "USDT", label: "USDT", icon: "https://assets.coingecko.com/coins/images/325/small/Tether.png" },
  { key: "SOL",  label: "SOL",  icon: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
];

function getEqualWeights(basket: BasketConfig): Record<string, number> {
  return Object.fromEntries(basket.allocations.map((a) => [a.mint, a.weight]));
}

function getMarketCapWeights(basket: BasketConfig): Record<string, number> {
  return Object.fromEntries(basket.allocations.map((a) => [a.mint, a.marketCapWeight]));
}

export function SwapPanel({
  basket,
  marketCapWeights,
  defaultMode,
  weightMode,
  onWeightModeChange,
  customWeights,
  onWeightsChange,
  defaultCustomWeights,
}: {
  basket: BasketConfig;
  marketCapWeights?: Record<string, number> | null;
  defaultMode: WeightMode;
  weightMode: WeightMode;
  onWeightModeChange: (mode: WeightMode) => void;
  customWeights?: Record<string, number> | null;
  onWeightsChange?: (weights: Record<string, number> | null) => void;
  defaultCustomWeights?: Record<string, number> | null;
}) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { prices } = usePrices();

  const [amountInput, setAmountInput] = useState("");
  const [inputAsset, setInputAsset] = useState<InputAssetKey>("USDC");
  const [maxBalance, setMaxBalance] = useState<number | null>(null);
  const [showAssetMenu, setShowAssetMenu] = useState(false);
  const [showCustomize, setShowCustomize] = useState(weightMode === "custom");
  const [status, setStatus] = useState<SwapStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultBundleId, setResultBundleId] = useState<string | null>(null);
  const [lockedMints, setLockedMints] = useState<Set<string>>(new Set());
  const [editingMint, setEditingMint] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // O(1) mint → allocation lookup used during quote preview rendering
  const tokenConfigByMint = useMemo(
    () => new Map(basket.allocations.map((a) => [a.mint, a])),
    [basket.allocations]
  );

  // Resolve active weights based on mode (mirrors page-level logic).
  // Memoized so the object identity stays stable unless the underlying
  // strategy or weights actually change — this prevents the quote hook
  // from re-running every render.
  const activeWeights: Record<string, number> = useMemo(() => {
    if (weightMode === "marketcap") return marketCapWeights ?? getMarketCapWeights(basket);
    if (weightMode === "equal") return getEqualWeights(basket);
    return customWeights ?? getEqualWeights(basket);
  }, [basket, weightMode, marketCapWeights, customWeights]);

  const amount = parseFloat(amountInput) || 0;

  // Resolve mint for selected input asset
  const inputMint =
    inputAsset === "USDT" ? USDT_MINT : inputAsset === "SOL" ? WSOL_MINT : USDC_MINT;

  const { preview, loading: previewLoading, error: previewError } = useSwapPreview(
    basket,
    amount,
    activeWeights,
    undefined,
    inputMint
  );

  // Fetch balance for selected asset
  useEffect(() => {
    // Hide Max while loading a fresh balance for the newly selected asset
    setMaxBalance(null);

    const fetchBalance = async () => {
      if (!wallet.publicKey) {
        setMaxBalance(null);
        return;
      }

      try {
        if (inputAsset === "SOL") {
          const lamports = await connection.getBalance(wallet.publicKey);
          const sol = lamports / 1_000_000_000;
          const GAS_BUFFER_SOL = 0.02;
          const usable = Math.max(0, sol - GAS_BUFFER_SOL);
          setMaxBalance(usable);
        } else {
          const mint = inputAsset === "USDT" ? USDT_MINT : USDC_MINT;
          const { getAssociatedTokenAddress } = await import("@solana/spl-token");
          const mintPk = new PublicKey(mint);
          const ata = await getAssociatedTokenAddress(mintPk, wallet.publicKey);
          const account = await connection.getTokenAccountBalance(ata).catch(() => null);
          if (!account) {
            setMaxBalance(0);
          } else {
            const uiAmount = account.value.uiAmount ?? 0;
            setMaxBalance(uiAmount);
          }
        }
      } catch {
        setMaxBalance(null);
      }
    };

    fetchBalance();
  }, [wallet.publicKey, connection, inputAsset]);

  const toggleLock = useCallback((mint: string) => {
    setLockedMints((prev) => {
      const next = new Set(prev);
      next.has(mint) ? next.delete(mint) : next.add(mint);
      return next;
    });
  }, []);

  const updateWeight = useCallback(
    (mint: string, newWeight: number) => {
      const current = customWeights || getEqualWeights(basket);
      newWeight = Math.max(5, Math.min(90, Math.round(newWeight)));
      const otherMints = basket.allocations.map((a) => a.mint).filter((m) => m !== mint && !lockedMints.has(m));
      if (otherMints.length === 0) return;
      const diff = newWeight - current[mint];
      const otherTotal = otherMints.reduce((s, m) => s + current[m], 0);
      const updated = { ...current, [mint]: newWeight };
      for (const m of otherMints) {
        const share = otherTotal > 0 ? current[m] / otherTotal : 1 / otherMints.length;
        updated[m] = Math.max(5, Math.round(current[m] - diff * share));
      }
      const sum = Object.values(updated).reduce((s, v) => s + v, 0);
      if (sum !== 100) {
        const last = otherMints[otherMints.length - 1];
        updated[last] = Math.max(5, updated[last] + (100 - sum));
      }
      if (onWeightsChange) onWeightsChange(updated);
      if (wallet.publicKey) saveCustomWeights(wallet.publicKey.toString(), basket.id, updated);
    },
    [customWeights, basket, wallet.publicKey, onWeightsChange, lockedMints]
  );

  const handleEditSubmit = useCallback((mint: string) => {
    const val = parseInt(editValue, 10);
    if (!isNaN(val) && val >= 5 && val <= 90) updateWeight(mint, val);
    setEditingMint(null);
    setEditValue("");
  }, [editValue, updateWeight]);

  const resetWeights = useCallback(() => {
    if (onWeightsChange) onWeightsChange(defaultCustomWeights ?? null);
    if (wallet.publicKey) {
      if (defaultCustomWeights) {
        saveCustomWeights(wallet.publicKey.toString(), basket.id, defaultCustomWeights);
      } else {
        clearCustomWeights(wallet.publicKey.toString(), basket.id);
      }
    }
    setLockedMints(new Set());
  }, [wallet.publicKey, basket.id, onWeightsChange, defaultCustomWeights]);

  const handleInvest = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signAllTransactions || !preview) return;
    setStatus("signing");
    setErrorMsg(null);
    try {
      setStatus("submitting");
      const result = await executeBasketBuy(
        connection,
        { publicKey: wallet.publicKey, signAllTransactions: wallet.signAllTransactions },
        preview.quotes,
        preview.totalFeeAmount
      );
      if (result.success) {
        setStatus("success");
        setResultBundleId(result.bundleId || null);
        const totalWeight = Object.values(activeWeights).reduce((s, v) => s + v, 0) || 100;
        savePurchaseRecord(wallet.publicKey.toString(), {
          id: crypto.randomUUID(),
          basketId: basket.id,
          timestamp: Date.now(),
          usdcInvested: preview.netInputAmount,
          weights: activeWeights,
          allocations: preview.allocations.map((a) => ({
            mint: a.mint,
            symbol: a.symbol,
            ratio: (activeWeights[a.mint] ?? a.weight) / totalWeight,
            priceAtPurchase: prices[a.mint] ?? 0,
          })),
          bundleId: result.bundleId || "",
          txSignatures: result.txSignatures || [],
        });
      } else {
        setStatus("error");
        setErrorMsg(result.error || "Transaction failed");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }, [wallet, preview, connection, basket, amount, activeWeights, tokenConfigByMint]);

  // Only recomputed when disableMarketcap changes (i.e. almost never)
  const modes = useMemo<{ key: WeightMode; label: string }[]>(() => [
    ...(!basket.disableMarketcap ? [{ key: "marketcap" as WeightMode, label: "Market Cap" }] : []),
    { key: "equal", label: "Equal" },
    { key: "custom", label: "Custom" },
  ], [basket.disableMarketcap]);

  return (
    <div className="space-y-6">
      {/* Weight Mode Selector */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground">Weight Strategy</span>
        </div>
        <div className={`grid gap-2 ${modes.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {modes.map(({ key, label }) => {
            const isActive = weightMode === key;
            const isRecommended = key === defaultMode;
            return (
              <button
                key={key}
                onClick={() => {
                  onWeightModeChange(key);
                  setShowCustomize(key === "custom");
                }}
                className="relative rounded-lg py-2 px-3 text-sm font-medium transition-all duration-150 text-center cursor-pointer"
                style={{
                  background: isActive ? "rgba(0,196,140,0.12)" : "transparent",
                  border: isActive ? "1px solid #00C48C" : "1px solid #1F2A22",
                  color: isActive ? "#00C48C" : "#9FB8AD",
                }}
              >
                {isRecommended && (
                  <span
                    className="absolute top-0 -translate-y-1/2 right-1.5 cursor-help"
                    title="Recommended"
                    style={{ color: "#00C48C", fontSize: "13px", lineHeight: 1 }}
                  >
                    ✦
                  </span>
                )}
                {label}
              </button>
            );
          })}
        </div>

        {/* Custom weights panel */}
        {weightMode === "custom" && (
          <div className="mt-3 space-y-4 p-4 rounded-lg border bg-muted/20" style={{ borderColor: "#1F2A22" }}>
            {basket.allocations.map((alloc) => {
              const w = customWeights?.[alloc.mint] ?? alloc.weight;
              const isLocked = lockedMints.has(alloc.mint);
              const isEditing = editingMint === alloc.mint;
              return (
                <div key={alloc.mint} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: "#E6F2ED" }}>{alloc.symbol}</span>
                    <div className="flex items-center gap-1.5">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => handleEditSubmit(alloc.mint)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditSubmit(alloc.mint);
                            if (e.key === "Escape") { setEditingMint(null); setEditValue(""); }
                          }}
                          autoFocus
                          min={5} max={90}
                          className="w-12 text-right font-mono text-sm bg-background border border-primary/30 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingMint(alloc.mint); setEditValue(String(w)); }}
                          className="font-mono text-sm hover:text-primary active:scale-[0.97] active:brightness-90 transition-all cursor-text px-1 rounded hover:bg-primary/10"
                        >
                          {w}%
                        </button>
                      )}
                      <button
                        onClick={() => toggleLock(alloc.mint)}
                        className={`w-6 h-6 flex items-center justify-center rounded transition-all active:scale-[0.97] active:brightness-90 ${isLocked ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                        title={isLocked ? "Unlock" : "Lock"}
                      >
                        {isLocked ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <Slider
                    value={[w]} min={5} max={90} step={1}
                    disabled={isLocked}
                    onValueChange={([val]) => updateWeight(alloc.mint, val)}
                    className={isLocked ? "opacity-40" : ""}
                  />
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={resetWeights}>Reset to Default</Button>
          </div>
        )}

        {/* Market cap / equal: show weight preview */}
        {weightMode !== "custom" && activeWeights && (
          <div className="mt-3 space-y-1">
            {basket.allocations.map((alloc) => (
              <div key={alloc.mint} className="flex items-center justify-between text-xs" style={{ color: "#9FB8AD" }}>
                <span>{alloc.symbol}</span>
                <span className="font-mono">{activeWeights[alloc.mint]}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Amount Input */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-muted-foreground">
            Investment Amount ({inputAsset})
          </label>
          {wallet.publicKey && maxBalance !== null && (
            <button
              type="button"
              className="text-xs text-primary hover:underline active:scale-[0.97] active:brightness-90 transition-all"
              onClick={() => {
                if (maxBalance !== null) {
                  setAmountInput(maxBalance.toFixed(4));
                  setStatus("idle");
                }
              }}
            >
              Max: {maxBalance.toFixed(2)} {inputAsset}
            </button>
          )}
        </div>
        <div className="relative mt-1">
          <input
            type="number"
            value={amountInput}
            onChange={(e) => { setAmountInput(e.target.value); setStatus("idle"); }}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="w-full px-4 pr-28 py-3 rounded-lg border border-primary/20 bg-background text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {/* Asset dropdown */}
          <button
            type="button"
            onClick={() => setShowAssetMenu((v) => !v)}
            className="absolute inset-y-1 right-1 px-2 rounded-md flex items-center gap-2 border border-primary/30 bg-black/40 hover:bg-black/60 active:scale-[0.97] active:brightness-90 transition-all text-sm cursor-pointer"
          >
            {(() => {
              const current = INPUT_ASSETS.find((a) => a.key === inputAsset)!;
              return (
                <>
                  <img
                    src={current.icon}
                    alt={current.label}
                    className="w-5 h-5 rounded-full"
                  />
                  <span>{current.label}</span>
                </>
              );
            })()}
            <span className="text-xs text-muted-foreground">▾</span>
          </button>
          {showAssetMenu && (
            <div className="absolute right-1 top-full mt-1 w-40 rounded-md border border-primary/30 bg-background shadow-lg z-10">
              {INPUT_ASSETS.map((asset) => (
                <button
                  key={asset.key}
                  type="button"
                  onClick={() => {
                    setInputAsset(asset.key);
                    setShowAssetMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-primary/10 cursor-pointer"
                >
                  <img
                    src={asset.icon}
                    alt={asset.label}
                    className="w-5 h-5 rounded-full"
                  />
                  <span>{asset.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview */}
      {amount > 0 && (
        <div className="space-y-2">
          <span className="text-sm font-medium">
            Estimated Output{" "}
            {previewLoading && <span className="text-muted-foreground">(loading...)</span>}
          </span>
          {previewError && <p className="text-sm text-destructive">{previewError}</p>}
          {preview && (
            <div className="space-y-2">
              {preview.allocations.map((alloc) => {
                const tokenConfig = tokenConfigByMint.get(alloc.mint);
                const outputNum = parseFloat(alloc.estimatedOutput) / 10 ** (tokenConfig?.decimals ?? 6);
                const weightForMint = activeWeights[alloc.mint] ?? alloc.weight;
                const inputForMint = amount * (weightForMint / 100);
                return (
                  <div key={alloc.mint} className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      {inputForMint.toFixed(2)} {inputAsset} → {alloc.symbol}
                    </span>
                    <span className="font-mono">{outputNum.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                  </div>
                );
              })}
              <Separator />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Platform fee (0.1%)</span>
                <span>{preview.totalFeeAmount.toFixed(4)} {inputAsset}</span>
              </div>
              {preview.allocations.some((a) => a.priceImpactPct > 1) && (
                <p className="text-xs text-yellow-500">Warning: High price impact on some swaps. Consider reducing the amount.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action Button */}
      {!wallet.publicKey ? (
        <Button className="w-full" size="lg" onClick={() => setVisible(true)}>Connect Wallet</Button>
      ) : status === "success" ? (
        <div className="text-center space-y-2">
          <p className="text-primary font-medium">Investment successful!</p>
          {resultBundleId && <p className="text-xs text-muted-foreground font-mono">Bundle: {resultBundleId.slice(0, 16)}...</p>}
          <Button variant="outline" onClick={() => { setStatus("idle"); setAmountInput(""); }}>Invest Again</Button>
        </div>
      ) : status === "error" ? (
        <div className="text-center space-y-2">
          <p className="text-destructive text-sm">{errorMsg}</p>
          <Button variant="outline" onClick={() => setStatus("idle")}>Try Again</Button>
        </div>
      ) : (
        <Button
          className="w-full" size="lg"
          disabled={amount <= 0 || previewLoading || !preview || status === "signing" || status === "submitting"}
          onClick={handleInvest}
        >
          {status === "signing"
            ? "Signing transactions..."
            : status === "submitting"
            ? "Submitting bundle..."
            : `Invest ${amount.toFixed(2)} ${inputAsset}`}
        </Button>
      )}

      <p className="text-xs text-center text-muted-foreground">
        Estimated amounts may vary due to market movement. All tokens go directly to your wallet.
      </p>
    </div>
  );
}
