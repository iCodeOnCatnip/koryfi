/**
 * scripts/prefetch-charts.ts
 *
 * Runs before `next build` via the "prebuild" npm script.
 * Fetches historical chart data for every basket and writes warm cache files
 * to .chart-cache/ so that every user's first request is served instantly.
 *
 * On Vercel (serverless): next.config.ts bundles these files into the
 * /api/chart function via outputFileTracingIncludes. The function reads the
 * pre-built cache on every cold start — no live fetch required.
 *
 * Optimisations vs naïve per-basket approach:
 *   - All unique Pyth feeds fetched once and shared across baskets
 *     (eliminates duplicate day-requests for tokens like BTC that appear
 *     in multiple baskets: 52 requests instead of ~208)
 *   - Pyth and CoinGecko fetched in parallel (independent APIs / rate limits)
 *   - Basket assembly runs concurrently (pure CPU, no I/O)
 *   - O(1) price lookups via Maps instead of O(n) Array.findIndex
 */

import fs from "fs";
import path from "path";
import { BASKETS } from "../src/lib/baskets/config";

const HERMES_BENCHMARK = "https://hermes.pyth.network/v2/updates/price";
const CG_BASE = "https://api.coingecko.com/api/v3";
const CACHE_DIR = path.join(process.cwd(), ".chart-cache");
const CHART_TTL = 86_400_000; // 24h — must match route.ts
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const UPSTASH_TTL_SECONDS = 24 * 60 * 60;

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function isFresh(key: string): boolean {
  const fp = path.join(CACHE_DIR, `${key}.json`);
  try {
    if (!fs.existsSync(fp)) return false;
    return Date.now() - fs.statSync(fp).mtimeMs < CHART_TTL;
  } catch {
    return false;
  }
}

function writeCache(key: string, data: unknown) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
}

async function writeUpstashChart(
  basketId: string,
  year: number,
  payload: unknown
): Promise<void> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return;
  try {
    const key = `chart:${year}:${basketId}`;
    await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["SET", key, JSON.stringify(payload), "EX", String(UPSTASH_TTL_SECONDS)],
      ]),
    });
  } catch {
    // non-fatal during prebuild
  }
}

// ── Pyth ─────────────────────────────────────────────────────────────────────

interface PythParsed {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

async function fetchPythDay(
  timestamp: number,
  priceIds: string[]
): Promise<Record<string, number>> {
  const params = new URLSearchParams();
  for (const id of priceIds) params.append("ids[]", id);
  params.set("parsed", "true");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${HERMES_BENCHMARK}/${timestamp}?${params}`);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return {};
      const data: { parsed: PythParsed[] } = await res.json();
      const prices: Record<string, number> = {};
      for (const p of data.parsed) {
        prices[p.id.replace("0x", "")] =
          Number(p.price.price) * 10 ** p.price.expo;
      }
      return prices;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return {};
}

// ── CoinGecko ────────────────────────────────────────────────────────────────

async function fetchCoinGeckoChart(
  coingeckoId: string,
  days: number
): Promise<[number, number][] | null> {
  const url = `${CG_BASE}/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()).prices;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      output[current] = await fn(items[current], current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
      worker()
    )
  );
  return output;
}

// ── Basket assembly (pure CPU — no I/O, runs in parallel) ───────────────────

function assembleBasket(
  basket: (typeof BASKETS)[0],
  // tsMs → cleanPythId → price  (shared, read-only)
  allPythPrices: Map<number, Map<string, number>>,
  // mint → ts → price  (shared, read-only)
  allCgData: Map<string, Map<number, number>>,
  jan1Ms: number
): { basketId: string; data: { timestamp: number; prices: Record<string, number> }[] } | null {
  const pythTokens = basket.allocations.filter((a) => a.pythPriceId);
  const cgOnlyTokens = basket.allocations.filter((a) => !a.pythPriceId);
  const cgMintSet = new Set(cgOnlyTokens.map((t) => t.mint));

  // Build canonical timestamp set
  const canonicalTsSet = new Set<number>();
  if (pythTokens.length > 0) {
    // Pyth timestamps are authoritative — use whatever came back
    for (const tsMs of allPythPrices.keys()) canonicalTsSet.add(tsMs);
  } else {
    // CG-only basket: normalise to midnight and filter to this year
    for (const t of cgOnlyTokens) {
      const map = allCgData.get(t.mint);
      if (!map) continue;
      for (const ts of map.keys()) {
        const midnight = Math.round(ts / 86_400_000) * 86_400_000;
        if (midnight >= jan1Ms) canonicalTsSet.add(midnight);
      }
    }
  }

  const canonicalTs = Array.from(canonicalTsSet).sort((a, b) => a - b);
  if (canonicalTs.length === 0) return null;

  // Nearest-neighbour CG lookup (exact hit first, then linear scan fallback)
  function lookupCgPrice(mint: string, tsMs: number): number {
    const map = allCgData.get(mint);
    if (!map || map.size === 0) return 0;
    if (map.has(tsMs)) return map.get(tsMs)!;
    let best = 0,
      bestDiff = Infinity;
    for (const [t, p] of map) {
      const diff = Math.abs(t - tsMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    return best;
  }

  const chartData = canonicalTs.map((tsMs) => {
    const prices: Record<string, number> = {};
    const dayPrices = allPythPrices.get(tsMs); // O(1) Map lookup
    for (const alloc of basket.allocations) {
      if (cgMintSet.has(alloc.mint)) {
        prices[alloc.mint] = lookupCgPrice(alloc.mint, tsMs);
      } else {
        // O(1) — Map instead of Array.findIndex
        const cleanId = alloc.pythPriceId!.replace("0x", "");
        prices[alloc.mint] = dayPrices?.get(cleanId) ?? 0;
      }
    }
    return { timestamp: tsMs, prices };
  });

  return { basketId: basket.id, data: chartData };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nPrefetching chart data for ${BASKETS.length} baskets...\n`);

  // 1. Skip baskets whose cache is still fresh
  const staleBaskets = BASKETS.filter((b) => {
    if (isFresh(`basket_${b.id}`)) {
      console.log(`  [skip]  ${b.id} — cache is fresh`);
      return false;
    }
    return true;
  });

  if (staleBaskets.length === 0) {
    console.log("\nAll caches fresh — nothing to do.\n");
    return;
  }

  // 2. Time constants (same for every basket)
  const year = new Date().getUTCFullYear();
  const jan1Ms = Date.UTC(year, 0, 1);
  const nowMs = Date.now();
  const days = Math.ceil((nowMs - jan1Ms) / 86400000);

  // 3. Collect ALL unique Pyth feeds + CG tokens across stale baskets
  //    De-duplication means BTC is fetched once even if it appears in 3 baskets.
  const allPythIdSet = new Set<string>();
  const cgMintToId = new Map<string, string>(); // mint → coingeckoId

  for (const basket of staleBaskets) {
    for (const alloc of basket.allocations) {
      if (alloc.pythPriceId) allPythIdSet.add(alloc.pythPriceId);
      else cgMintToId.set(alloc.mint, alloc.coingeckoId);
    }
  }

  const allPythIds = Array.from(allPythIdSet);

  // Shared price stores (written by fetch steps, read by assembly)
  const allPythPrices = new Map<number, Map<string, number>>();
  const allCgData = new Map<string, Map<number, number>>();

  // 4. Fetch Pyth and CoinGecko in parallel (independent APIs)
  const fetchPyth = async () => {
    if (allPythIds.length === 0) return;
    console.log(
      `  [pyth]  fetching ${allPythIds.length} feeds × ~${days} days...`
    );

    const dailyTimestamps: number[] = [];
    const nowUnix = Math.floor(nowMs / 1000);
    for (let d = 0; d <= days; d++) {
      const ts = Math.floor(Date.UTC(year, 0, 1 + d) / 1000);
      if (ts <= nowUnix) dailyTimestamps.push(ts);
    }

    // 20 concurrent requests per batch, sequential batches (respects rate limit)
    const BATCH_SIZE = 20;
    for (let i = 0; i < dailyTimestamps.length; i += BATCH_SIZE) {
      const batch = dailyTimestamps.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((ts) =>
          fetchPythDay(ts, allPythIds).then((prices) => ({ ts, prices }))
        )
      );
      for (const { ts, prices } of results) {
        allPythPrices.set(ts * 1000, new Map(Object.entries(prices)));
      }
    }
  };

  const fetchCG = async () => {
    if (cgMintToId.size === 0) return;
    const entries = Array.from(cgMintToId.entries()).map(([mint, coingeckoId]) => ({
      mint,
      coingeckoId,
    }));
    console.log(`  [cg]    fetching ${entries.length} tokens...`);

    await mapWithConcurrency(entries, 2, async ({ mint, coingeckoId }) => {
      const cgPrices = await fetchCoinGeckoChart(coingeckoId, days + 30);
      if (!cgPrices || cgPrices.length === 0) {
        allCgData.set(mint, new Map());
        return;
      }
      // Drop incomplete trailing candle if CG returned two points for today
      let src = cgPrices;
      if (cgPrices.length >= 2) {
        const last = cgPrices[cgPrices.length - 1][0];
        const prev = cgPrices[cgPrices.length - 2][0];
        if (last - prev < 43_200_000) src = cgPrices.slice(0, -1);
      }
      const map = new Map<number, number>();
      for (const [ts, price] of src) map.set(ts, price);
      allCgData.set(mint, map);
    });
  };

  await Promise.all([fetchPyth(), fetchCG()]);

  // 5. Assemble all baskets in parallel (pure CPU, no I/O blocking)
  await Promise.all(
    staleBaskets.map(async (basket) => {
      const result = assembleBasket(basket, allPythPrices, allCgData, jan1Ms);
      if (!result) {
        console.log(`  [warn]  ${basket.id} — no data received, skipping cache`);
        return;
      }
      writeCache(`basket_${basket.id}`, result);
      writeCache(`basket_${basket.id}_${year}`, result);
      await writeUpstashChart(basket.id, year, result);
      console.log(`  [done]  ${basket.id} — ${result.data.length} data points`);
    })
  );

  console.log("\nDone — .chart-cache/ is warm.\n");
}

main().catch((err) => {
  console.error("Prefetch failed:", err);
  process.exit(1);
});

