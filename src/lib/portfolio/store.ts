import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { PurchaseRecord } from "@/lib/baskets/types";

type WalletHistoryStore = Record<string, PurchaseRecord[]>;

const STORE_PATH = path.join(process.cwd(), ".purchase-history.json");
const TMP_STORE_PATH = path.join(os.tmpdir(), "koryfi-purchase-history.json");
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_ENABLED = Boolean(REDIS_URL && REDIS_TOKEN);
const REDIS_PREFIX = "koryfi:history";

function redisWalletKey(wallet: string): string {
  return `${REDIS_PREFIX}:wallet:${wallet}`;
}

function normalizeWallet(wallet: string): string {
  return wallet.trim();
}

async function readStore(): Promise<WalletHistoryStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as WalletHistoryStore;
  } catch {
    try {
      const rawTmp = await fs.readFile(TMP_STORE_PATH, "utf8");
      return JSON.parse(rawTmp) as WalletHistoryStore;
    } catch {
      return {};
    }
  }
}

async function writeStore(store: WalletHistoryStore): Promise<void> {
  try {
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    await fs.writeFile(TMP_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  }
}

async function redisCommand(parts: (string | number)[]): Promise<unknown> {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Redis not configured");
  }
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([parts]),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redis command failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as Array<{ result?: unknown }>;
  return data?.[0]?.result;
}

function sortRecords(records: PurchaseRecord[]): PurchaseRecord[] {
  return [...records].sort((a, b) => a.timestamp - b.timestamp);
}

export async function getWalletPurchaseRecords(wallet: string): Promise<PurchaseRecord[]> {
  const normalized = normalizeWallet(wallet);
  if (!normalized) return [];

  if (REDIS_ENABLED) {
    try {
      const raw = (await redisCommand(["GET", redisWalletKey(normalized)])) as
        | string
        | null;
      if (!raw) return [];
      return sortRecords(JSON.parse(raw) as PurchaseRecord[]);
    } catch {
      // Fall through to local fallback.
    }
  }

  const store = await readStore();
  return sortRecords(store[normalized] ?? []);
}

export async function appendWalletPurchaseRecord(
  wallet: string,
  record: PurchaseRecord
): Promise<void> {
  const normalized = normalizeWallet(wallet);
  if (!normalized) return;

  if (REDIS_ENABLED) {
    try {
      const key = redisWalletKey(normalized);
      const raw = (await redisCommand(["GET", key])) as string | null;
      const existing = raw ? (JSON.parse(raw) as PurchaseRecord[]) : [];
      if (!existing.some((r) => r.id === record.id)) {
        existing.push(record);
      }
      await redisCommand(["SET", key, JSON.stringify(sortRecords(existing))]);
      return;
    } catch {
      // Fall through to local fallback.
    }
  }

  const store = await readStore();
  const existing = store[normalized] ?? [];
  if (!existing.some((r) => r.id === record.id)) {
    existing.push(record);
  }
  store[normalized] = sortRecords(existing);
  await writeStore(store);
}
