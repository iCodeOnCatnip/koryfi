import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, isAllowedCoinGeckoId } from "@/lib/server/security";

/**
 * Server-side proxy for CoinGecko historical chart data only.
 *
 * Query params:
 *   type=market_chart -> /coins/{id}/market_chart?vs_currency=usd&days=...&interval=daily
 */

const CG_BASE = "https://api.coingecko.com/api/v3";
const CHART_TTL = 86_400_000; // 24h
const MAX_CACHE_ENTRIES = 500;
const REQUEST_GAP_MS = 2_000; // 2s between requests
const FETCH_TIMEOUT_MS = 15_000;

const cache: Record<string, { data: unknown; ts: number }> = {};
let queueTail: Promise<void> = Promise.resolve();
let lastRequestTime = 0;

function pruneCache(now: number) {
  for (const key of Object.keys(cache)) {
    if (now - cache[key].ts >= CHART_TTL) delete cache[key];
  }
}

function enforceCacheBound() {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  keys
    .sort((a, b) => cache[a].ts - cache[b].ts)
    .slice(0, keys.length - MAX_CACHE_ENTRIES)
    .forEach((key) => delete cache[key]);
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queueTail = queueTail
      .then(async () => {
        const elapsed = Date.now() - lastRequestTime;
        if (elapsed < REQUEST_GAP_MS) {
          await new Promise((r) => setTimeout(r, REQUEST_GAP_MS - elapsed));
        }
        lastRequestTime = Date.now();
        return fn();
      })
      .then(resolve)
      .catch(reject);
  });
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (res.status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
        continue;
      }
      return res;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error("Exhausted retries");
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, "api:coingecko", 30, 60_000);
  if (rateLimited) return rateLimited;

  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");
  if (type !== "market_chart") {
    return NextResponse.json({ error: "Only type=market_chart is supported" }, { status: 400 });
  }

  const id = searchParams.get("id");
  const daysRaw = searchParams.get("days");
  if (!id || !daysRaw) {
    return NextResponse.json({ error: "Missing id or days" }, { status: 400 });
  }
  if (!isAllowedCoinGeckoId(id)) {
    return NextResponse.json({ error: "Unsupported token id" }, { status: 400 });
  }

  const daysNum = parseInt(daysRaw, 10);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
    return NextResponse.json({ error: "days must be between 1 and 365" }, { status: 400 });
  }

  const days = daysNum.toString();
  const cacheKey = `chart:${id}:${days}`;
  const now = Date.now();
  pruneCache(now);

  const cached = cache[cacheKey];
  if (cached && now - cached.ts < CHART_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const url = `${CG_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const data = await enqueue(async () => {
      const res = await fetchWithRetry(url);
      if (!res.ok) {
        const text = (await res.text()).slice(0, 240);
        console.error(`CoinGecko chart error ${res.status}: ${text}`);
        if (cached) return cached.data;
        throw new Error(`CoinGecko ${res.status}`);
      }
      return res.json();
    });

    cache[cacheKey] = { data, ts: now };
    enforceCacheBound();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
