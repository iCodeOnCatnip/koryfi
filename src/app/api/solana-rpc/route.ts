import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHeliusRpcUrl(): string | null {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key) return null;
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, "api:solana-rpc", 300, 60_000);
  if (rateLimited) return rateLimited;

  const heliusUrl = getHeliusRpcUrl();
  if (!heliusUrl) {
    return NextResponse.json(
      { error: "HELIUS_API_KEY is not configured on server" },
      { status: 500 }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON-RPC payload" }, { status: 400 });
  }

  try {
    const upstream = await fetch(heliusUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "RPC upstream request failed" }, { status: 502 });
  }
}
