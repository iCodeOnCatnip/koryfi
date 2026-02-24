import { NextRequest, NextResponse } from "next/server";
import { redeemCode } from "@/lib/access/store";

export const runtime = "nodejs";

function extractIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { code?: string; fingerprint?: string };
    const code = body?.code?.trim();
    const fingerprint = body?.fingerprint?.trim();

    if (!code || !fingerprint) {
      return NextResponse.json(
        { error: "Missing code or fingerprint" },
        { status: 400 }
      );
    }

    const result = await redeemCode({
      code,
      fingerprint,
      ip: extractIp(request),
    });

    if (!result.ok) {
      const status = result.reason === "invalid_code" ? 401 : 409;
      const error =
        result.reason === "invalid_code"
          ? "Invalid access code"
          : "This code is already tied to another device/browser";
      return NextResponse.json({ error }, { status });
    }

    return NextResponse.json({
      allowed: true,
      code: result.record.code,
      reused: result.reused,
    });
  } catch {
    return NextResponse.json({ error: "Failed to redeem code" }, { status: 500 });
  }
}
