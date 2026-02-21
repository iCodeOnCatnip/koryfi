import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/marketcap?ids=bitcoin,ethereum,solana
 *
 * Returns rounded market-cap weights (sum = 100) per coingeckoId.
 *
 * Cache policy: refresh once per week, on Monday.
 * - On every request, check if the cached data was fetched in the current Monday's window.
 * - If stale (fetched before this Monday 00:00:00 UTC), re-fetch from CoinGecko.
 * - Falls back to stale cache if CoinGecko is unavailable.
 */

const CACHE_DIR = path.join(process.cwd(), ".chart-cache");
const CACHE_FILE = path.join(CACHE_DIR, "marketcap-weights.json");

interface CacheEntry {
  fetchedAt: number; // unix ms
  weights: Record<string, Record<string, number>>; // idSet -> { id -> weight }
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache(): CacheEntry | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry) {
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry));
  } catch {}
}

/** Returns the Unix ms timestamp for the most recent Monday at 00:00:00 UTC */
function lastMondayMidnightUTC(): number {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const daysBack = day === 0 ? 6 : day - 1; // days since last Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
  return monday.getTime();
}

function isCacheStale(fetchedAt: number): boolean {
  return fetchedAt < lastMondayMidnightUTC();
}

function computeWeights(idList: string[], capById: Record<string, number>): Record<string, number> {
  const total = idList.reduce((s, id) => s + (capById[id] || 0), 0);
  if (total === 0) return {};
  const raw = idList.map((id) => ({ id, pct: ((capById[id] || 0) / total) * 100 }));
  const floored = raw.map((r) => ({ id: r.id, w: Math.floor(r.pct), frac: r.pct % 1 }));
  const remainder = 100 - floored.reduce((s, r) => s + r.w, 0);
  floored.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) floored[i].w += 1;
  return Object.fromEntries(floored.map((r) => [r.id, r.w]));
}

export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get("ids");
  if (!ids) return NextResponse.json({ error: "Missing ids" }, { status: 400 });

  const idList = ids.split(",").filter(Boolean).sort(); // sort for stable cache key
  const cacheKey = idList.join(",");

  // Check disk cache
  const cached = readCache();
  if (cached && !isCacheStale(cached.fetchedAt) && cached.weights[cacheKey]) {
    return NextResponse.json({ weights: cached.weights[cacheKey], cached: true });
  }

  // Fetch fresh from CoinGecko
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cacheKey}&per_page=50`,
      { headers: { Accept: "application/json" } }
    );

    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

    const data: { id: string; market_cap: number }[] = await res.json();
    const capById: Record<string, number> = {};
    for (const item of data) capById[item.id] = item.market_cap;

    const weights = computeWeights(idList, capById);

    // Persist to cache (merge with existing keys)
    const existing = readCache();
    const newEntry: CacheEntry = {
      fetchedAt: Date.now(),
      weights: { ...(existing?.weights ?? {}), [cacheKey]: weights },
    };
    writeCache(newEntry);

    return NextResponse.json({ weights, cached: false });
  } catch {
    // CoinGecko unavailable — return stale cache if we have it
    if (cached?.weights[cacheKey]) {
      return NextResponse.json({ weights: cached.weights[cacheKey], cached: true, stale: true });
    }
    return NextResponse.json({ error: "CoinGecko unavailable and no cache" }, { status: 502 });
  }
}
