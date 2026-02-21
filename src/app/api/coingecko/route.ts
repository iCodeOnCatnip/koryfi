import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for CoinGecko historical chart data only.
 * Live prices are handled by Pyth + Jupiter (no CoinGecko needed).
 *
 * - Serialized queue with 2s gaps to stay within free-tier rate limits
 * - 24-hour cache for daily closes (they're immutable once the day passes)
 * - Retry with backoff on 429
 *
 * Query params:
 *   type=market_chart → /coins/{id}/market_chart?vs_currency=usd&days=...&interval=daily
 */

const CG_BASE = "https://api.coingecko.com/api/v3";

// ── Cache (24h for charts — daily closes don't change) ─────────────
const cache: Record<string, { data: unknown; ts: number }> = {};
const CHART_TTL = 86_400_000; // 24 hours

// ── Request queue — serializes all CoinGecko calls ─────────────────
const REQUEST_GAP_MS = 2_000; // 2s between requests
let queueTail: Promise<void> = Promise.resolve();
let lastRequestTime = 0;

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
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      continue;
    }
    return res;
  }
  throw new Error("Exhausted retries");
}

// ── Route handler ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");

  if (type !== "market_chart") {
    return NextResponse.json(
      { error: "Only type=market_chart is supported" },
      { status: 400 }
    );
  }

  const id = searchParams.get("id");
  const days = searchParams.get("days");
  if (!id || !days) {
    return NextResponse.json({ error: "Missing id or days" }, { status: 400 });
  }

  const cacheKey = `chart:${id}:${days}`;
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.ts < CHART_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const url = `${CG_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;

    const data = await enqueue(async () => {
      const res = await fetchWithRetry(url);
      if (!res.ok) {
        const text = await res.text();
        console.error(`CoinGecko chart error ${res.status}:`, text);
        if (cached) return cached.data; // stale cache fallback
        throw new Error(`CoinGecko ${res.status}`);
      }
      return res.json();
    });

    cache[cacheKey] = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    console.error("CoinGecko proxy error:", err);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
