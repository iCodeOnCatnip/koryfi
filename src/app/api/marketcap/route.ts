import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { enforceRateLimit, isAllowedCoinGeckoId } from "@/lib/server/security";

/**
 * GET /api/marketcap?ids=bitcoin,ethereum,solana
 *
 * Returns rounded market-cap weights (sum = 100) per coingeckoId.
 * Cache policy: refresh once per week, on Monday.
 */

const CACHE_DIR = path.join(process.cwd(), ".chart-cache");
const CACHE_FILE = path.join(CACHE_DIR, "marketcap-weights.json");
const MAX_IDS_PER_REQUEST = 25;

interface CacheEntry {
  fetchedAt: number;
  weights: Record<string, Record<string, number>>;
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

function lastMondayMidnightUTC(): number {
  const now = new Date();
  const day = now.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
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
  const rateLimited = enforceRateLimit(req, "api:marketcap", 30, 60_000);
  if (rateLimited) return rateLimited;

  const ids = req.nextUrl.searchParams.get("ids");
  if (!ids) return NextResponse.json({ error: "Missing ids" }, { status: 400 });

  const idList = Array.from(new Set(ids.split(",").map((id) => id.trim()).filter(Boolean))).sort();
  if (idList.length === 0) return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  if (idList.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json({ error: `Too many ids requested (max ${MAX_IDS_PER_REQUEST})` }, { status: 400 });
  }
  if (idList.some((id) => !isAllowedCoinGeckoId(id))) {
    return NextResponse.json({ error: "Invalid or unsupported token id" }, { status: 400 });
  }

  const cacheKey = idList.join(",");
  const cached = readCache();
  if (cached && !isCacheStale(cached.fetchedAt) && cached.weights[cacheKey]) {
    return NextResponse.json({ weights: cached.weights[cacheKey], cached: true });
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cacheKey}&per_page=50`,
      { headers: { Accept: "application/json" } }
    );

    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error("Unexpected CoinGecko response shape");
    const capById: Record<string, number> = {};
    for (const item of raw) {
      if (typeof item?.id === "string" && typeof item?.market_cap === "number") {
        capById[item.id] = item.market_cap;
      }
    }

    const weights = computeWeights(idList, capById);

    const existing = readCache();
    const newEntry: CacheEntry = {
      fetchedAt: Date.now(),
      weights: { ...(existing?.weights ?? {}), [cacheKey]: weights },
    };
    writeCache(newEntry);

    return NextResponse.json({ weights, cached: false });
  } catch {
    if (cached?.weights[cacheKey]) {
      return NextResponse.json({ weights: cached.weights[cacheKey], cached: true, stale: true });
    }
    return NextResponse.json({ error: "CoinGecko unavailable and no cache" }, { status: 502 });
  }
}
