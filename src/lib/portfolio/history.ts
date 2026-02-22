import { PurchaseRecord } from "../baskets/types";

const STORAGE_PREFIX = "basket_purchases_";

/** Migrate a raw localStorage record from the old tokensReceived format to the new allocations format. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateRecord(raw: any): PurchaseRecord {
  if (raw.allocations) return raw as PurchaseRecord;
  // Old format: has tokensReceived[] instead of allocations[]
  const weights: Record<string, number> = raw.weights ?? {};
  const totalWeight = Object.values(weights).reduce((s, v) => s + (v as number), 0) || 100;
  return {
    id: raw.id,
    basketId: raw.basketId,
    timestamp: raw.timestamp,
    usdcInvested: raw.usdcInvested,
    weights,
    allocations: (raw.tokensReceived ?? []).map((t: { mint: string; symbol: string; priceAtPurchase: number }) => ({
      mint: t.mint,
      symbol: t.symbol,
      ratio: (weights[t.mint] ?? 0) / totalWeight,
      priceAtPurchase: t.priceAtPurchase,
    })),
    bundleId: raw.bundleId ?? "",
    txSignatures: raw.txSignatures ?? [],
  };
}

export function savePurchaseRecord(
  walletPubkey: string,
  record: PurchaseRecord
): void {
  if (typeof window === "undefined") return;
  const key = `${STORAGE_PREFIX}${walletPubkey}`;
  const existing = getPurchaseRecords(walletPubkey);
  existing.push(record);
  localStorage.setItem(key, JSON.stringify(existing));
}

export function getPurchaseRecords(walletPubkey: string): PurchaseRecord[] {
  if (typeof window === "undefined") return [];
  const key = `${STORAGE_PREFIX}${walletPubkey}`;
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as unknown[]).flatMap((r) => {
      try { return [migrateRecord(r)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

// v2: bumped to invalidate stale weight saves from previous sessions
const WEIGHTS_VERSION = "v2";

export function getCustomWeights(
  walletPubkey: string,
  basketId: string
): Record<string, number> | null {
  if (typeof window === "undefined") return null;
  const key = `custom_weights_${WEIGHTS_VERSION}_${walletPubkey}_${basketId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveCustomWeights(
  walletPubkey: string,
  basketId: string,
  weights: Record<string, number>
): void {
  if (typeof window === "undefined") return;
  const key = `custom_weights_${WEIGHTS_VERSION}_${walletPubkey}_${basketId}`;
  localStorage.setItem(key, JSON.stringify(weights));
}

export function clearCustomWeights(
  walletPubkey: string,
  basketId: string
): void {
  if (typeof window === "undefined") return;
  const key = `custom_weights_${WEIGHTS_VERSION}_${walletPubkey}_${basketId}`;
  localStorage.removeItem(key);
}
