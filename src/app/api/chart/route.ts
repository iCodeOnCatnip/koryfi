import { NextRequest, NextResponse } from "next/server";
import { BASKETS } from "@/lib/baskets/config";
import { enforceRateLimit } from "@/lib/server/security";

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
 * Caching: in-memory, 24h TTL. First request per basket per cold-start does
 * the full fetch; every subsequent request within the same instance returns
 * instantly from memory. Compatible with Vercel (no filesystem writes).
 */

const HERMES_BENCHMARK = "https://hermes.pyth.network/v2/updates/price";
const CG_BASE = "https://api.coingecko.com/api/v3";
const FETCH_TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}
const CHART_TTL = 86_400_000; // 24h

// ── In-memory cache ─────────────────────────────────────────────────
const memCache = new Map<string, { data: unknown; ts: number }>();

function readCache(key: string): unknown | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CHART_TTL) {
    memCache.delete(key);
    return null;
  }
  return entry.data;
}

function writeCache(key: string, data: unknown) {
  memCache.set(key, { data, ts: Date.now() });
}

// In-flight dedup: prevents concurrent requests from triggering duplicate fetches
const inFlight = new Map<string, Promise<unknown>>();

function isStaleZeroTailCache(payload: unknown, pythMints: string[]): boolean {
  if (pythMints.length === 0) return false;
  if (!payload || typeof payload !== "object") return false;

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return false;

  const tail = data.slice(-Math.min(7, data.length)) as Array<{ prices?: Record<string, number> }>;
  // If any Pyth-tracked mint is all-zero across the recent tail, cache is bad.
  return pythMints.some((mint) =>
    tail.every((point) => {
      const v = point?.prices?.[mint];
      return typeof v === "number" && v <= 0;
    })
  );
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
      const res = await fetchWithTimeout(`${HERMES_BENCHMARK}/${timestamp}?${params}`);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return {};

      const data: { parsed: PythParsed[] } = await res.json();
      const prices: Record<string, number> = {};
      for (const p of data.parsed) {
        prices[p.id.replace("0x", "")] = Number(p.price.price) * 10 ** p.price.expo;
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
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json();
      if (!Array.isArray(json?.prices)) return null;
      return json.prices as [number, number][];
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
  const rateLimited = enforceRateLimit(req, "api:chart", 20, 60_000);
  if (rateLimited) return rateLimited;

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
  const pythMints = basket.allocations.filter((a) => a.pythPriceId).map((a) => a.mint);
  if (cached && !isStaleZeroTailCache(cached, pythMints)) {
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
    const days = Math.ceil((nowMs - jan1Ms) / DAY_MS);

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

    // O(1) lookup maps for Pyth prices — replaces O(n) Array.findIndex in chartData loop
    const mintPriceMaps = new Map<string, Map<number, number>>();
    for (const t of pythTokens) {
      mintPriceMaps.set(t.mint, new Map(mintPrices[t.mint]));
    }

    // ── Fetch CoinGecko only for tokens without Pyth feeds ───────────
    const cgPriceMaps: Record<string, Map<number, number>> = {};
    for (const t of basket.allocations) {
      cgPriceMaps[t.mint] = new Map();
    }

    // Only request CG data for tokens that actually need it (no pythPriceId)
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
      for (const [ts, price] of src) {
        map.set(ts, price);
        map.set(Math.round(ts / DAY_MS) * DAY_MS, price);
      }

      const fromJan1 = src.filter(([ts]) => {
        const midnight = Math.round(ts / DAY_MS) * DAY_MS;
        return midnight >= jan1Ms;
      });
      mintPrices[t.mint] = fromJan1.length > 0 ? fromJan1 : src;
    });

    const cgSortedTs: Record<string, number[]> = {};
    for (const t of basket.allocations) {
      cgSortedTs[t.mint] = Array.from(cgPriceMaps[t.mint].keys()).sort((a, b) => a - b);
    }

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
          canonicalTsSet.add(Math.round(ts / DAY_MS) * DAY_MS);
        }
      }
    }

    const canonicalTs = Array.from(canonicalTsSet).sort((a, b) => a - b);
    if (canonicalTs.length === 0) return null;

    function lookupCgPrice(mint: string, tsMs: number): number {
      const map = cgPriceMaps[mint];
      if (!map || map.size === 0) return 0;
      if (map.has(tsMs)) return map.get(tsMs)!;
      const rounded = Math.round(tsMs / DAY_MS) * DAY_MS;
      if (map.has(rounded)) return map.get(rounded)!;

      const sorted = cgSortedTs[mint];
      if (!sorted || sorted.length === 0) return 0;

      let lo = 0;
      let hi = sorted.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = sorted[mid];
        if (v === tsMs) return map.get(v)!;
        if (v < tsMs) lo = mid + 1;
        else hi = mid - 1;
      }

      const left = hi >= 0 ? sorted[hi] : null;
      const right = lo < sorted.length ? sorted[lo] : null;
      if (left === null && right === null) return 0;
      if (left === null) return map.get(right!) ?? 0;
      if (right === null) return map.get(left) ?? 0;
      return Math.abs(right - tsMs) < Math.abs(tsMs - left)
        ? (map.get(right) ?? 0)
        : (map.get(left) ?? 0);
    }

    const chartData = canonicalTs.map((tsMs) => {
      const prices: Record<string, number> = {};
      for (const alloc of basket.allocations) {
        if (alloc.pythPriceId) {
          const pythPrice = mintPriceMaps.get(alloc.mint)?.get(tsMs) ?? 0;
          prices[alloc.mint] = pythPrice > 0 ? pythPrice : lookupCgPrice(alloc.mint, tsMs);
        } else {
          prices[alloc.mint] = lookupCgPrice(alloc.mint, tsMs);
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
