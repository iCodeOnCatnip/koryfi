import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHeliusRpcUrl(): string | null {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key) return null;
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

const PUBLIC_RPC_FALLBACK = "https://api.mainnet-beta.solana.com";

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, "api:solana-rpc", 300, 60_000);
  if (rateLimited) return rateLimited;

  const heliusUrl = getHeliusRpcUrl();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON-RPC payload" }, { status: 400 });
  }

  try {
    const forward = async (url: string) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

    let upstream = await forward(heliusUrl ?? PUBLIC_RPC_FALLBACK);
    if (heliusUrl && (upstream.status === 401 || upstream.status === 403)) {
      // Misconfigured/expired server key: degrade gracefully instead of hard-failing swaps.
      upstream = await forward(PUBLIC_RPC_FALLBACK);
    }

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "RPC upstream request failed" }, { status: 502 });
  }
}
