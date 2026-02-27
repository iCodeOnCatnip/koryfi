import { PurchaseRecord } from "../baskets/types";

const STORAGE_PREFIX = "basket_purchases_";
export const PURCHASE_SAVED_EVENT = "koryfi:purchase-saved";

function storageKey(walletPubkey: string): string {
  return `${STORAGE_PREFIX}${walletPubkey}`;
}

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
  const key = storageKey(walletPubkey);
  const existing = getPurchaseRecords(walletPubkey);
  if (!existing.some((r) => r.id === record.id)) {
    existing.push(record);
  }
  localStorage.setItem(key, JSON.stringify(existing));
  window.dispatchEvent(
    new CustomEvent(PURCHASE_SAVED_EVENT, {
      detail: { walletPubkey, basketId: record.basketId, recordId: record.id },
    })
  );

  // Best-effort remote sync so history follows wallet across devices.
  void fetch("/api/purchase-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletPubkey, record }),
    keepalive: true,
  }).catch(() => {
    // Local save already succeeded.
  });
}

// Hide platform-fee transfer tx from user-facing swap history.
// Old records may still include it at index 0.
export function getVisibleSwapSignatures(
  record: { txSignatures: string[]; allocations: { length: number } }
): string[] {
  if (!record.txSignatures?.length) return [];
  const hasFeeAtIndex0 = record.txSignatures.length > record.allocations.length;
  return hasFeeAtIndex0 ? record.txSignatures.slice(1) : record.txSignatures;
}

export function getPurchaseRecords(walletPubkey: string): PurchaseRecord[] {
  if (typeof window === "undefined") return [];
  const key = storageKey(walletPubkey);
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

function mergeRecords(
  localRecords: PurchaseRecord[],
  remoteRecords: PurchaseRecord[]
): PurchaseRecord[] {
  const byId = new Map<string, PurchaseRecord>();
  for (const r of localRecords) byId.set(r.id, r);
  for (const r of remoteRecords) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function getPurchaseRecordsSynced(
  walletPubkey: string
): Promise<PurchaseRecord[]> {
  const localRecords = getPurchaseRecords(walletPubkey);
  try {
    const res = await fetch(
      `/api/purchase-history?wallet=${encodeURIComponent(walletPubkey)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return localRecords;
    const data = (await res.json()) as { records?: PurchaseRecord[] };
    const merged = mergeRecords(localRecords, data.records ?? []);
    if (typeof window !== "undefined") {
      localStorage.setItem(storageKey(walletPubkey), JSON.stringify(merged));
    }
    return merged;
  } catch {
    return localRecords;
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
