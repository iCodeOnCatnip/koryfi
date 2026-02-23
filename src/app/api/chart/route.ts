import { NextRequest, NextResponse } from "next/server";
import { BASKETS } from "@/lib/baskets/config";
import { enforceRateLimit } from "@/lib/server/security";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

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
const FETCH_TIMEOUT_MS = 8_000;
const DAY_MS = 86_400_000;
const CACHE_DIR = path.join(process.cwd(), ".chart-cache");
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CHART_TTL_SECONDS = 24 * 60 * 60;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}
const CHART_TTL_MS = 24 * 60 * 60_000; // 24h

// ── In-memory cache ─────────────────────────────────────────────────
const memCache = new Map<string, { data: unknown; ts: number }>();

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function payloadYear(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as { timestamp?: unknown };
  if (typeof first?.timestamp !== "number") return null;
  return new Date(first.timestamp).getUTCFullYear();
}

function readDiskCache(key: string): { data: unknown; ts: number } | null {
  const fp = path.join(CACHE_DIR, `${key}.json`);
  try {
    if (!fs.existsSync(fp)) return null;
    const stat = fs.statSync(fp);
    const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as unknown;
    return { data, ts: stat.mtimeMs };
  } catch {
    return null;
  }
}

function readCache(key: string, expectedYear: number, legacyKey?: string): unknown | null {
  const fromMem = memCache.get(key);
  if (fromMem) {
    if (Date.now() - fromMem.ts <= CHART_TTL_MS && payloadYear(fromMem.data) === expectedYear) {
      return fromMem.data;
    }
    memCache.delete(key);
  }

  const diskCurrent = readDiskCache(key);
  if (diskCurrent) {
    if (Date.now() - diskCurrent.ts <= CHART_TTL_MS && payloadYear(diskCurrent.data) === expectedYear) {
      memCache.set(key, diskCurrent);
      return diskCurrent.data;
    }
  }

  if (legacyKey) {
    const diskLegacy = readDiskCache(legacyKey);
    if (diskLegacy) {
      if (Date.now() - diskLegacy.ts <= CHART_TTL_MS && payloadYear(diskLegacy.data) === expectedYear) {
        memCache.set(key, { data: diskLegacy.data, ts: diskLegacy.ts });
        return diskLegacy.data;
      }
    }
  }

  return null;
}

function writeCache(key: string, data: unknown) {
  memCache.set(key, { data, ts: Date.now() });
  try {
    ensureCacheDir();
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch {
    // ignore disk write issues; memory cache still works
  }
}

function getUpstashKey(basketId: string, year: number): string {
  return `chart:${year}:${basketId}`;
}

async function readUpstashCache(basketId: string, year: number): Promise<ChartPayload | null> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    };
    const key = getUpstashKey(basketId, year);
    const res = await fetchWithTimeout(
      `${UPSTASH_REDIS_REST_URL}/pipeline`,
      {
        method: "POST",
        headers,
        body: JSON.stringify([["GET", key]]),
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ result?: unknown }>;
    const raw = json?.[0]?.result;
    if (typeof raw !== "string") return null;
    const parsed = JSON.parse(raw) as { basketId?: string; data?: unknown };
    if (parsed?.basketId !== basketId || !Array.isArray(parsed?.data)) return null;
    return parsed as ChartPayload;
  } catch {
    return null;
  }
}

async function writeUpstashCache(basketId: string, year: number, payload: ChartPayload) {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    };
    const key = getUpstashKey(basketId, year);
    await fetchWithTimeout(
      `${UPSTASH_REDIS_REST_URL}/pipeline`,
      {
        method: "POST",
        headers,
        body: JSON.stringify([
          ["SET", key, JSON.stringify(payload), "EX", String(CHART_TTL_SECONDS)],
        ]),
      }
    );
  } catch {
    // non-fatal: local cache remains source of truth
  }
}

// In-flight dedup: prevents concurrent requests from triggering duplicate fetches
const inFlight = new Map<string, Promise<unknown>>();

type ChartPoint = { timestamp: number; prices: Record<string, number> };
type ChartPayload = { basketId: string; data: ChartPoint[] };

function isStaleCache(payload: unknown, allMints: string[], expectedDays: number): boolean {
  if (!payload || typeof payload !== "object") return true;

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return true;

  // Reject if too few data points — indicates incomplete/aborted build fetch.
  // Allow 5-day buffer for weekends, timezone edge cases, new baskets.
  if (data.length < Math.max(1, expectedDays - 5)) return true;

  // Reject if any tracked mint is all-zero across the recent 7-day tail.
  // Applies to ALL mints (Pyth and CG-only) so sunrise/sol-staking are covered.
  if (allMints.length === 0) return false;
  const tail = data.slice(-Math.min(7, data.length)) as Array<{ prices?: Record<string, number> }>;
  return allMints.some((mint) =>
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
async function fetchCoinGeckoChart(coingeckoId: string, days: number): Promise<[number, number][] | null> {
  const url = `${CG_BASE}/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json();
      if (!Array.isArray(json?.prices)) return null;
      return json.prices as [number, number][];
    } catch {
      if (attempt < 1) await new Promise((r) => setTimeout(r, 1500));
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
  const year = new Date().getUTCFullYear();
  const cacheKey = `basket_${basket.id}_${year}`;
  const allMints = basket.allocations.map((a) => a.mint);
  const jan1Ms = Date.UTC(year, 0, 1);
  const expectedDays = Math.ceil((Date.now() - jan1Ms) / DAY_MS);

  // CDN cache header for pre-warmed responses: serve instantly from Vercel edge for 5 min,
  // then revalidate in background. Historical daily closes don't change intraday.
  const CDN_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

  // ── 1. Memory/disk first (instant, no network) ──────────────────────
  const cached = readCache(cacheKey, year, `basket_${basket.id}`);
  if (cached && !isStaleCache(cached, allMints, expectedDays)) {
    return NextResponse.json(cached, { headers: CDN_HEADERS });
  }

  // ── 2. Upstash shared cache (serves all instances/cold-starts) ──────
  const externalCached = await readUpstashCache(basket.id, year);
  if (externalCached && !isStaleCache(externalCached, allMints, expectedDays)) {
    writeCache(cacheKey, externalCached);
    return NextResponse.json(externalCached, { headers: CDN_HEADERS });
  }

  // Dedup concurrent requests for the same basket — register promise before
  // awaiting so all concurrent requests share the same fetch, then clean up.
  if (inFlight.has(cacheKey)) {
    const result = await inFlight.get(cacheKey)!;
    return NextResponse.json(result, { headers: CDN_HEADERS });
  }

  const fetchPromise = (async () => {
    const days = Math.ceil((Date.now() - jan1Ms) / DAY_MS);

    // Split tokens: Pyth vs CoinGecko-only
    const pythTokens = basket.allocations.filter((a) => a.pythPriceId);
    const cgOnlyTokens = basket.allocations.filter((a) => !a.pythPriceId);

    const pythIds: string[] = [];
    for (const t of pythTokens) pythIds.push(t.pythPriceId!);

    // ── Fetch Pyth historical data (skipped for all-CG baskets) ──────
    const mintPrices: Record<string, [number, number][]> = {};

    if (pythTokens.length > 0) {
      const dailyTimestamps: number[] = [];
      const nowUnix = Math.floor(Date.now() / 1000);
      for (let d = 0; d <= days; d++) {
        const ts = Math.floor(Date.UTC(year, 0, 1 + d) / 1000);
        if (ts <= nowUnix) dailyTimestamps.push(ts);
      }

      // Higher parallelism without fixed inter-batch sleeps significantly reduces
      // first-load latency; retries in fetchPythDay still handle transient 429s.
      const pythDayPrices: Record<number, Record<string, number>>[] = [];
      const results = await mapWithConcurrency(dailyTimestamps, 20, async (ts) => {
        const prices = await fetchPythDay(ts, pythIds);
        return { ts, prices };
      });
      for (const r of results) pythDayPrices.push({ [r.ts]: r.prices });

      for (const t of pythTokens) mintPrices[t.mint] = [];

      // Sort day maps chronologically so forward-fill sees previous days first.
      const sortedDayPrices = pythDayPrices
        .map((m) => {
          const [tsStr, prices] = Object.entries(m)[0];
          return { tsMs: Number(tsStr) * 1000, prices };
        })
        .sort((a, b) => a.tsMs - b.tsMs);

      const lastKnown: Record<string, number> = {};
      for (const { tsMs, prices } of sortedDayPrices) {
        for (const t of pythTokens) {
          const cleanId = t.pythPriceId!.replace("0x", "");
          const raw = prices[cleanId];
          const price = typeof raw === "number" && raw > 0 ? raw : (lastKnown[t.mint] ?? 0);
          if (price > 0) lastKnown[t.mint] = price;
          mintPrices[t.mint].push([tsMs, price]);
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

    // Request CG data for all tokens so pyth-gaps can fallback instead of going flat.
    await mapWithConcurrency(basket.allocations, 2, async (t) => {
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
      if (!t.pythPriceId) {
        mintPrices[t.mint] = fromJan1.length > 0 ? fromJan1 : src;
      }
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

  const historical = result as ChartPayload;
  writeCache(cacheKey, historical);
  await writeUpstashCache(basket.id, year, historical);
  // Fresh fetch — short CDN TTL; client overlays live tail via usePrices()
  return NextResponse.json(historical, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
