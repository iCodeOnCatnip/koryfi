import { NextRequest, NextResponse } from "next/server";
import { BASKETS } from "@/lib/baskets/config";
import fs from "fs";
import path from "path";

/**
 * GET /api/chart?basket=sol-defi
 *
 * Returns complete historical chart data for a basket in ONE client call.
 *
 * Strategy:
 *   - Pyth Benchmarks for tokens WITH pythPriceId (12 tokens) —
 *     ALL tokens fetched in a single request per day, ~49 requests total.
 *     Rate limit: 30 req/10s = very fast.
 *   - CoinGecko for tokens WITHOUT pythPriceId (pSOL, hSOL, bonkSOL) —
 *     Only 3 requests, sequential with 2s gap.
 *
 * Caching: disk-based, 24h TTL, survives server restarts.
 */

const HERMES_BENCHMARK = "https://hermes.pyth.network/v2/updates/price";
const CG_BASE = "https://api.coingecko.com/api/v3";
const CACHE_DIR = path.join(process.cwd(), ".chart-cache");
const CHART_TTL = 86_400_000; // 24h

// In-flight dedup: prevents concurrent requests from triggering duplicate fetches
const inFlight = new Map<string, Promise<unknown>>();

// ── Disk cache ─────────────────────────────────────────────────────
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache(key: string): unknown | null {
  const fp = path.join(CACHE_DIR, `${key}.json`);
  try {
    if (!fs.existsSync(fp)) return null;
    if (Date.now() - fs.statSync(fp).mtimeMs > CHART_TTL) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown) {
  try {
    ensureCacheDir();
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch {}
}

// ── Pyth: fetch all tokens for a single day ────────────────────────
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
        prices[p.id] = Number(p.price.price) * 10 ** p.price.expo;
      }
      return prices;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return {};
}

// ── CoinGecko: fetch one token's chart ─────────────────────────────
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
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      output[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return output;
}

// ── Main handler ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const basketId = req.nextUrl.searchParams.get("basket");
  if (!basketId) {
    return NextResponse.json({ error: "Missing basket param" }, { status: 400 });
  }

  // Validate basket exists before any file I/O (prevents path traversal via basketId)
  const basket = BASKETS.find((b) => b.id === basketId);
  if (!basket) {
    return NextResponse.json({ error: "Basket not found" }, { status: 404 });
  }

  // Cache key is safe: basket.id comes from the validated BASKETS config, not raw user input
  const cacheKey = `basket_${basket.id}`;
  const cached = readCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  // Dedup concurrent requests for the same basket — register promise before
  // awaiting so all concurrent requests share the same fetch, then clean up.
  if (inFlight.has(cacheKey)) {
    const result = await inFlight.get(cacheKey)!;
    return NextResponse.json(result);
  }

  const fetchPromise = (async () => {
    const year = new Date().getUTCFullYear();
    const jan1Ms = Date.UTC(year, 0, 1); // midnight UTC Jan 1
    const nowMs = Date.now();
    const days = Math.ceil((nowMs - jan1Ms) / 86400000);

    // Split tokens: Pyth vs CoinGecko-only
    const pythTokens = basket.allocations.filter((a) => a.pythPriceId);
    const cgOnlyTokens = basket.allocations.filter((a) => !a.pythPriceId);

    const pythIds: string[] = [];
    for (const t of pythTokens) pythIds.push(t.pythPriceId!);

    // ── Fetch Pyth historical data (skipped for all-CG baskets) ──────
    const mintPrices: Record<string, [number, number][]> = {};

    if (pythTokens.length > 0) {
      const dailyTimestamps: number[] = [];
      const nowUnix = Math.floor(nowMs / 1000);
      for (let d = 0; d <= days; d++) {
        const ts = Math.floor(Date.UTC(year, 0, 1 + d) / 1000);
        if (ts <= nowUnix) dailyTimestamps.push(ts);
      }

      // Higher parallelism without fixed inter-batch sleeps significantly reduces
      // first-load latency; retries in fetchPythDay still handle transient 429s.
      const BATCH_SIZE = 20;
      const pythDayPrices: Record<number, Record<string, number>>[] = [];

      for (let i = 0; i < dailyTimestamps.length; i += BATCH_SIZE) {
        const batch = dailyTimestamps.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((ts) => fetchPythDay(ts, pythIds).then((prices) => ({ ts, prices })))
        );
        for (const r of results) pythDayPrices.push({ [r.ts]: r.prices });
      }

      for (const t of pythTokens) mintPrices[t.mint] = [];

      for (const dayMap of pythDayPrices) {
        const [tsStr, prices] = Object.entries(dayMap)[0];
        const tsMs = Number(tsStr) * 1000;
        for (const t of pythTokens) {
          const cleanId = t.pythPriceId!.replace("0x", "");
          mintPrices[t.mint].push([tsMs, prices[cleanId] ?? 0]);
        }
      }
    }

    // ── Fetch CoinGecko for tokens without Pyth feeds ────────────────
    const cgPriceMaps: Record<string, Map<number, number>> = {};
    for (const t of cgOnlyTokens) {
      cgPriceMaps[t.mint] = new Map();
    }

    await mapWithConcurrency(cgOnlyTokens, 2, async (t) => {
      const cgPrices = await fetchCoinGeckoChart(t.coingeckoId, days + 30);
      if (!cgPrices || cgPrices.length === 0) return;

      let src = cgPrices;
      if (cgPrices.length >= 2) {
        const last = cgPrices[cgPrices.length - 1][0];
        const prev = cgPrices[cgPrices.length - 2][0];
        if (last - prev < 43_200_000) {
          src = cgPrices.slice(0, -1);
        }
      }

      const map = cgPriceMaps[t.mint];
      for (const [ts, price] of src) map.set(ts, price);

      const fromJan1 = src.filter(([ts]) => {
        const midnight = Math.round(ts / 86_400_000) * 86_400_000;
        return midnight >= jan1Ms;
      });
      mintPrices[t.mint] = fromJan1.length > 0 ? fromJan1 : src;
    });

    // ── Build canonical timestamp set ─────────────────────────────────
    const canonicalTsSet = new Set<number>();
    if (pythTokens.length > 0) {
      let longest: [number, number][] = [];
      for (const t of pythTokens) {
        const arr = mintPrices[t.mint];
        if (arr && arr.length > longest.length) longest = arr;
      }
      for (const [ts] of longest) canonicalTsSet.add(ts);
    } else {
      for (const t of cgOnlyTokens) {
        const arr = mintPrices[t.mint];
        if (!arr) continue;
        for (const [ts] of arr) {
          canonicalTsSet.add(Math.round(ts / 86_400_000) * 86_400_000);
        }
      }
    }

    const canonicalTs = Array.from(canonicalTsSet).sort((a, b) => a - b);
    if (canonicalTs.length === 0) return null;

    function lookupCgPrice(mint: string, tsMs: number): number {
      const map = cgPriceMaps[mint];
      if (!map || map.size === 0) return 0;
      if (map.has(tsMs)) return map.get(tsMs)!;
      let best = 0;
      let bestDiff = Infinity;
      for (const [t, p] of map) {
        const diff = Math.abs(t - tsMs);
        if (diff < bestDiff) { bestDiff = diff; best = p; }
      }
      return best;
    }

    const cgMintSet = new Set(cgOnlyTokens.map((t) => t.mint));

    const chartData = canonicalTs.map((tsMs) => {
      const prices: Record<string, number> = {};
      for (const alloc of basket.allocations) {
        if (cgMintSet.has(alloc.mint)) {
          prices[alloc.mint] = lookupCgPrice(alloc.mint, tsMs);
        } else {
          const arr = mintPrices[alloc.mint];
          const idx = arr ? arr.findIndex(([t]) => t === tsMs) : -1;
          prices[alloc.mint] = idx !== -1 ? arr[idx][1] : 0;
        }
      }
      return { timestamp: tsMs, prices };
    });

    return { basketId: basket.id, data: chartData };
  })();

  // Register before awaiting so concurrent requests share this promise
  inFlight.set(cacheKey, fetchPromise);

  let result: unknown;
  try {
    result = await fetchPromise;
  } finally {
    // Always clean up — even on error — so the next request retries fresh
    inFlight.delete(cacheKey);
  }

  if (!result) {
    return NextResponse.json({ error: "No chart data" }, { status: 502 });
  }

  writeCache(cacheKey, result);
  return NextResponse.json(result);
}
