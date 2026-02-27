import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "getBalance",
  "getAccountInfo",
  "getRecentBlockhash",
  "getLatestBlockhash",
  "getFeeForMessage",
  "getSignatureStatuses",
  "getTransaction",
  "sendRawTransaction",
  "simulateTransaction",
  "getParsedTokenAccountsByOwner",
  "getTokenAccountBalance",
  "getSlot",
  "getBlockTime",
  "getMinimumBalanceForRentExemption",
]);

const MAX_BODY_BYTES = 512 * 1024; // 512 KB

function getHeliusRpcUrl(): string | null {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key) return null;
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

const PUBLIC_RPC_FALLBACK = "https://api.mainnet-beta.solana.com";

function extractMethods(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => (item as { method?: string })?.method ?? "");
  }
  return [(payload as { method?: string })?.method ?? ""];
}

function isAuthErrorPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as { error?: { code?: number; message?: string } };
  const code = p.error?.code;
  const msg = String(p.error?.message ?? "").toLowerCase();
  return code === 401 || code === 403 || msg.includes("forbidden") || msg.includes("unauthorized");
}

function isForbiddenRpcBody(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.some((item) => isAuthErrorPayload(item));
    }
    return isAuthErrorPayload(parsed);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    const rateLimited = enforceRateLimit(req, "api:solana-rpc", 1500, 60_000);
    if (rateLimited) return rateLimited;
  }

  // Reject oversized bodies before parsing
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const heliusUrl = getHeliusRpcUrl();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON-RPC payload" }, { status: 400 });
  }

  // Allowlist RPC methods — reject anything not needed by the app
  const methods = extractMethods(payload);
  const blocked = methods.find((m) => !ALLOWED_METHODS.has(m));
  if (blocked) {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 403 }
    );
  }

  try {
    const forward = async (url: string) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

    const upstreams = heliusUrl
      ? [
          { name: "helius", url: heliusUrl },
          { name: "public", url: PUBLIC_RPC_FALLBACK },
        ]
      : [{ name: "public", url: PUBLIC_RPC_FALLBACK }];

    let lastText = JSON.stringify({ error: "RPC upstream request failed" });
    let lastStatus = 502;

    for (const upstream of upstreams) {
      const res = await forward(upstream.url);
      const text = await res.text();
      const authFailure =
        res.status === 401 || res.status === 403 || isForbiddenRpcBody(text);

      lastText = text;
      lastStatus = res.status;

      if (authFailure) continue;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.NODE_ENV === "development") {
        headers["x-rpc-upstream"] = upstream.name;
      }
      return new NextResponse(text, { status: res.status, headers });
    }

    return new NextResponse(lastText, {
      status: lastStatus,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "RPC upstream request failed" }, { status: 502 });
  }
}
