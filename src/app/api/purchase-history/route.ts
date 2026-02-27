import { NextRequest, NextResponse } from "next/server";
import { PurchaseRecord } from "@/lib/baskets/types";
import {
  appendWalletPurchaseRecord,
  getWalletPurchaseRecords,
} from "@/lib/portfolio/store";

export const runtime = "nodejs";

const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isLikelyWallet(wallet: string): boolean {
  return WALLET_REGEX.test(wallet);
}

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get("wallet")?.trim() ?? "";
    if (!wallet || !isLikelyWallet(wallet)) {
      return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    }
    const records = await getWalletPurchaseRecords(wallet);
    return NextResponse.json({ records });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch purchase history" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      wallet?: string;
      record?: PurchaseRecord;
    };
    const wallet = body?.wallet?.trim() ?? "";
    const record = body?.record;
    if (!wallet || !isLikelyWallet(wallet) || !record?.id) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    await appendWalletPurchaseRecord(wallet, record);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save purchase history" },
      { status: 500 }
    );
  }
}
