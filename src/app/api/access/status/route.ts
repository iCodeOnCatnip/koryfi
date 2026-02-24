import { NextRequest, NextResponse } from "next/server";
import { getRedemptionByFingerprint } from "@/lib/access/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { fingerprint?: string };
    const fingerprint = body?.fingerprint?.trim();
    if (!fingerprint) {
      return NextResponse.json({ error: "Missing fingerprint" }, { status: 400 });
    }

    const record = await getRedemptionByFingerprint(fingerprint);
    return NextResponse.json({
      allowed: Boolean(record),
      code: record?.code ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to check access" }, { status: 500 });
  }
}
