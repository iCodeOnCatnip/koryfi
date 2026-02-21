import { NextRequest, NextResponse } from "next/server";
import { BASKETS } from "@/lib/baskets/config";

/**
 * GET /api/prices?mints=mint1,mint2,...
 *
 * Server-side price fetching - keeps API keys off the client.
 * Primary: Pyth Hermes (for tokens with pythPriceId)
 * Fallback: Jupiter Price API v3 (for remaining tokens)
 */

const HERMES_API = "https://hermes.pyth.network/v2/updates/price/latest";
const JUPITER_PRICE_API = "https://api.jup.ag/price/v3/price";

// Build lookup maps from basket config
function buildMaps() {
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
  return { mintToPyth, pythToMint };
}

export async function GET(req: NextRequest) {
  const mintsParam = req.nextUrl.searchParams.get("mints");
  if (!mintsParam) {
    return NextResponse.json({ error: "Missing mints param" }, { status: 400 });
  }

  const mints = mintsParam.split(",").filter(Boolean);
  if (mints.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  const { mintToPyth, pythToMint } = buildMaps();
  const prices: Record<string, number> = {};

  // Pyth Hermes for tokens with feeds
  const pythIds = mints.map((m) => mintToPyth[m]).filter(Boolean);
  if (pythIds.length > 0) {
    try {
      const params = new URLSearchParams();
      for (const id of pythIds) params.append("ids[]", id);
      const res = await fetch(`${HERMES_API}?${params}`);
      if (res.ok) {
        const data: { parsed: { id: string; price: { price: string; expo: number } }[] } =
          await res.json();
        for (const p of data.parsed) {
          const mint = pythToMint[p.id];
          if (mint) {
            prices[mint] = Number(p.price.price) * Math.pow(10, p.price.expo);
          }
        }
      }
    } catch {
      // Pyth failed - will fall through to Jupiter
    }
  }

  // Jupiter v3 fallback for missing mints
  const missing = mints.filter((m) => !prices[m]);
  if (missing.length > 0) {
    try {
      const apiKey = process.env.JUPITER_API_KEY; // server-only, no NEXT_PUBLIC_
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey) headers["x-api-key"] = apiKey;

      const res = await fetch(`${JUPITER_PRICE_API}?ids=${missing.join(",")}`, { headers });
      if (res.ok) {
        const data: Record<string, { usdPrice: number }> = await res.json();
        for (const mint of missing) {
          if (data[mint]?.usdPrice) prices[mint] = data[mint].usdPrice;
        }
      }
    } catch {
      // Jupiter failed - prices for these mints will be missing
    }
  }

  return NextResponse.json({ prices });
}