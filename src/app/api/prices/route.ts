import { NextRequest, NextResponse } from "next/server";
import { BASKETS } from "@/lib/baskets/config";
import { enforceRateLimit, isAllowedMint } from "@/lib/server/security";

/**
 * GET /api/prices?mints=mint1,mint2,...
 *
 * Server-side price fetching - keeps API keys off the client.
 * Primary: Pyth Hermes (for tokens with pythPriceId)
 * Fallback: Jupiter Price API v3 (for remaining tokens)
 */

const HERMES_API = "https://hermes.pyth.network/v2/updates/price/latest";
const JUPITER_PRICE_API = "https://api.jup.ag/price/v3/price";
const COINGECKO_SIMPLE_API = "https://api.coingecko.com/api/v3/simple/price";
const SANCTUM_SOL_VALUE_API = "https://sanctum-extra-api.ngrok.dev/v1/sol-value/many";
const FETCH_TIMEOUT_MS = 10_000;
const SOL_MINT = "So11111111111111111111111111111111111111112";
// LSTs that need Sanctum sol-value lookup when Jupiter/CoinGecko fail
const STAKED_SOL_MINTS = new Set([
  "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL", // pSOL
  "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A", // hSOL
  "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs", // bonkSOL
]);
const lastKnownPrices = new Map<string, number>();

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}

const mintToPyth: Record<string, string> = {};
const pythToMint: Record<string, string> = {};
const mintToCoingecko: Record<string, string> = {};
for (const basket of BASKETS) {
  for (const alloc of basket.allocations) {
    mintToCoingecko[alloc.mint] = alloc.coingeckoId;
    if (alloc.pythPriceId) {
      mintToPyth[alloc.mint] = alloc.pythPriceId;
      pythToMint[alloc.pythPriceId.replace("0x", "")] = alloc.mint;
    }
  }
}

function extractJupiterPrices(
  raw: unknown,
  mints: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  const data = raw as Record<string, unknown>;
  for (const mint of mints) {
    const entry = data[mint];
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const usdPrice = (entry as Record<string, unknown>).usdPrice;
      if (typeof usdPrice === "number" && usdPrice > 0) out[mint] = usdPrice;
    }
  }
  return out;
}

async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};

  const apiKey = process.env.JUPITER_API_KEY;
  const call = async (withKey: boolean) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (withKey && apiKey) headers["x-api-key"] = apiKey;
    return fetchWithTimeout(`${JUPITER_PRICE_API}?ids=${mints.join(",")}`, { headers });
  };

  try {
    let res = await call(true);
    if ((res.status === 401 || res.status === 403) && apiKey) {
      res = await call(false);
    }
    if (!res.ok) return {};
    return extractJupiterPrices(await res.json(), mints);
  } catch {
    return {};
  }
}

// Sanctum: authoritative SOL-value per LST → convert to USD using SOL price
async function fetchSanctumLstPrices(
  mints: string[],
  solUsdPrice: number
): Promise<Record<string, number>> {
  if (mints.length === 0 || solUsdPrice <= 0) return {};
  try {
    const params = new URLSearchParams();
    for (const mint of mints) params.append("mints[]", mint);
    const res = await fetchWithTimeout(`${SANCTUM_SOL_VALUE_API}?${params}`);
    if (!res.ok) return {};
    const json = (await res.json()) as { sol_values?: Record<string, number> };
    const out: Record<string, number> = {};
    for (const mint of mints) {
      const solVal = json.sol_values?.[mint];
      if (typeof solVal === "number" && solVal > 0) out[mint] = solVal * solUsdPrice;
    }
    return out;
  } catch {
    return {};
  }
}

async function fetchCoinGeckoSimplePrices(mints: string[]): Promise<Record<string, number>> {
  const pairs = mints
    .map((mint) => ({ mint, id: mintToCoingecko[mint] }))
    .filter((x) => !!x.id);
  if (pairs.length === 0) return {};

  try {
    const ids = Array.from(new Set(pairs.map((x) => x.id)));
    const url = `${COINGECKO_SIMPLE_API}?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return {};
    const raw = await res.json();
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};

    const byId = raw as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const { mint, id } of pairs) {
      const entry = byId[id];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const usd = (entry as Record<string, unknown>).usd;
      if (typeof usd === "number" && usd > 0) out[mint] = usd;
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, "api:prices", 120, 60_000);
  if (rateLimited) return rateLimited;

  const mintsParam = req.nextUrl.searchParams.get("mints");
  if (!mintsParam) {
    return NextResponse.json({ error: "Missing mints param" }, { status: 400 });
  }

  const rawMints = Array.from(new Set(mintsParam.split(",").map((m) => m.trim()).filter(Boolean)));
  if (rawMints.length === 0) return NextResponse.json({ prices: {} });
  if (rawMints.length > 50) {
    return NextResponse.json({ error: "Too many mints requested (max 50)" }, { status: 400 });
  }

  // Filter to known basket mints only — unknown mints (random wallet tokens) are silently
  // skipped so the whole request isn't rejected when a user holds non-basket tokens.
  // Security is preserved: we never call external APIs for arbitrary/unknown mints.
  const mints = rawMints.filter(isAllowedMint);
  if (mints.length === 0) return NextResponse.json({ prices: {} });

  const prices: Record<string, number> = {};

  const pythIds = mints.map((m) => mintToPyth[m]).filter(Boolean);
  if (pythIds.length > 0) {
    try {
      const params = new URLSearchParams();
      for (const id of pythIds) params.append("ids[]", id);
      const res = await fetchWithTimeout(`${HERMES_API}?${params}`);
      if (res.ok) {
        const data: { parsed: { id: string; price: { price: string; expo: number } }[] } =
          await res.json();
        for (const p of data.parsed) {
          const mint = pythToMint[p.id.replace("0x", "")];
          if (mint) prices[mint] = Number(p.price.price) * Math.pow(10, p.price.expo);
        }
      }
    } catch {
      // Pyth failed - will fall through to Jupiter
    }
  }

  let missing = mints.filter((m) => !prices[m]);
  if (missing.length > 0) {
    const jup = await fetchJupiterPrices(missing);
    Object.assign(prices, jup);
  }

  // Final fallback for non-Pyth tokens (e.g. pSOL/hSOL/bonkSOL)
  missing = mints.filter((m) => !prices[m]);
  if (missing.length > 0) {
    const cg = await fetchCoinGeckoSimplePrices(missing);
    Object.assign(prices, cg);
  }

  // Sanctum fallback for LSTs still missing after Jupiter + CoinGecko.
  // Uses actual SOL-value per LST × SOL USD price — accurate, not a proxy.
  const missingLsts = mints.filter((m) => !prices[m] && STAKED_SOL_MINTS.has(m));
  if (missingLsts.length > 0) {
    const solUsd =
      prices[SOL_MINT] ||
      prices["mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"] ||
      prices["J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"] ||
      0;
    const sanctum = await fetchSanctumLstPrices(missingLsts, solUsd);
    Object.assign(prices, sanctum);
  }

  // Last-known fallback for transient outages/rate limits.
  for (const mint of mints) {
    const current = prices[mint];
    if (typeof current === "number" && current > 0) {
      lastKnownPrices.set(mint, current);
      continue;
    }
    const prev = lastKnownPrices.get(mint);
    if (typeof prev === "number" && prev > 0) {
      prices[mint] = prev;
    }
  }

  return NextResponse.json({ prices });
}
