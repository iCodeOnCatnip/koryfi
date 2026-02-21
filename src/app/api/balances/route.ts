import { NextRequest, NextResponse } from "next/server";

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

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "Missing address param" }, { status: 400 });
  }
  if (!HELIUS_API_KEY) {
    return NextResponse.json({ error: "Helius API key not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${address}/balances?api-key=${HELIUS_API_KEY}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: "Helius API error", status: res.status }, { status: res.status });
    }

    const data: {
      tokens: { mint: string; amount: number; decimals: number }[];
      nativeBalance: number;
    } = await res.json();

    const balances: Record<string, number> = {};

    for (const t of data.tokens ?? []) {
      if (t.amount > 0) {
        balances[t.mint] = t.amount / 10 ** t.decimals;
      }
    }

    if ((data.nativeBalance ?? 0) > 0) {
      balances[WSOL_MINT] = data.nativeBalance / 1e9;
    }

    return NextResponse.json({ balances });
  } catch {
    return NextResponse.json({ error: "Failed to fetch balances" }, { status: 500 });
  }
}
