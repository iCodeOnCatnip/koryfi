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
const FETCH_TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}

const mintToPyth: Record<string, string> = {};
const pythToMint: Record<string, string> = {};
for (const basket of BASKETS) {
  for (const alloc of basket.allocations) {
    if (alloc.pythPriceId) {
      mintToPyth[alloc.mint] = alloc.pythPriceId;
      pythToMint[alloc.pythPriceId.replace("0x", "")] = alloc.mint;
    }
  }
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, "api:prices", 120, 60_000);
  if (rateLimited) return rateLimited;

  const mintsParam = req.nextUrl.searchParams.get("mints");
  if (!mintsParam) {
    return NextResponse.json({ error: "Missing mints param" }, { status: 400 });
  }

  const mints = Array.from(new Set(mintsParam.split(",").map((m) => m.trim()).filter(Boolean)));
  if (mints.length === 0) {
    return NextResponse.json({ prices: {} });
  }
  if (mints.length > 25) {
    return NextResponse.json({ error: "Too many mints requested (max 25)" }, { status: 400 });
  }
  if (mints.some((mint) => !isAllowedMint(mint))) {
    return NextResponse.json({ error: "Invalid or unsupported mint" }, { status: 400 });
  }

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

  const missing = mints.filter((m) => !prices[m]);
  if (missing.length > 0) {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey) headers["x-api-key"] = apiKey;

      const res = await fetchWithTimeout(`${JUPITER_PRICE_API}?ids=${missing.join(",")}`, { headers });
      if (res.ok) {
        const raw: unknown = await res.json();
        if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
          const data = raw as Record<string, unknown>;
          for (const mint of missing) {
            const entry = data[mint];
            if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
              const usdPrice = (entry as Record<string, unknown>).usdPrice;
              if (typeof usdPrice === "number" && usdPrice > 0) prices[mint] = usdPrice;
            }
          }
        }
      }
    } catch {
      // Jupiter failed - prices for these mints will be missing
    }
  }

  return NextResponse.json({ prices });
}
