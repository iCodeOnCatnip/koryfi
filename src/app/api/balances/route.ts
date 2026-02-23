import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, MINT_REGEX } from "@/lib/server/security";

/**
 * GET /api/balances?address=<wallet_pubkey>
 *
 * Proxies the Helius /v0/addresses/{address}/balances endpoint server-side
 * to keep the API key off the client.
 *
 * Returns: { balances: Record<mint, uiAmount> }
 *   - SPL token balances as human-readable amounts
 *   - Native SOL balance under the wSOL mint key
 */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}

const BALANCE_TTL_MS = 20_000;
const MAX_BALANCE_CACHE_ENTRIES = 3000;
const balanceCache = new Map<string, { ts: number; balances: Record<string, number> }>();

function pruneBalanceCache(now: number) {
  for (const [key, entry] of balanceCache) {
    if (now - entry.ts >= BALANCE_TTL_MS) balanceCache.delete(key);
  }
  if (balanceCache.size <= MAX_BALANCE_CACHE_ENTRIES) return;
  let overflow = balanceCache.size - MAX_BALANCE_CACHE_ENTRIES;
  for (const key of balanceCache.keys()) {
    balanceCache.delete(key);
    overflow -= 1;
    if (overflow <= 0) break;
  }
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, "api:balances", 40, 60_000);
  if (rateLimited) return rateLimited;

  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "Missing address param" }, { status: 400 });
  }
  if (!MINT_REGEX.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (!HELIUS_API_KEY) {
    return NextResponse.json({ error: "Helius API key not configured" }, { status: 500 });
  }

  const now = Date.now();
  pruneBalanceCache(now);
  const cached = balanceCache.get(address);
  if (cached && now - cached.ts < BALANCE_TTL_MS) {
    return NextResponse.json({ balances: cached.balances, cached: true });
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.helius.xyz/v0/addresses/${address}/balances?api-key=${HELIUS_API_KEY}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch balances" }, { status: 502 });
    }

    const data: {
      tokens: { mint: string; amount: number; decimals: number }[];
      nativeBalance: number;
    } = await res.json();

    const balances: Record<string, number> = {};

    for (const t of data.tokens ?? []) {
      if (t.amount > 0) balances[t.mint] = t.amount / 10 ** t.decimals;
    }
    if ((data.nativeBalance ?? 0) > 0) {
      balances[WSOL_MINT] = data.nativeBalance / 1e9;
    }

    balanceCache.set(address, { ts: now, balances });
    return NextResponse.json({ balances });
  } catch {
    return NextResponse.json({ error: "Failed to fetch balances" }, { status: 500 });
  }
}
