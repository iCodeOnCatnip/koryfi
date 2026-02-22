import { NextRequest, NextResponse } from "next/server";
import { BASKETS } from "@/lib/baskets/config";

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();
const MAX_RATE_BUCKETS = 5000;

export const MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const COINGECKO_ID_REGEX = /^[a-z0-9-]{1,64}$/;

const knownMints = new Set<string>();
const knownCoinGeckoIds = new Set<string>();

for (const basket of BASKETS) {
  for (const alloc of basket.allocations) {
    knownMints.add(alloc.mint);
    knownCoinGeckoIds.add(alloc.coingeckoId);
  }
}

function pruneRateBuckets(now: number) {
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
  if (rateBuckets.size <= MAX_RATE_BUCKETS) return;

  let overflow = rateBuckets.size - MAX_RATE_BUCKETS;
  for (const key of rateBuckets.keys()) {
    rateBuckets.delete(key);
    overflow -= 1;
    if (overflow <= 0) break;
  }
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  return "unknown";
}

export function enforceRateLimit(
  req: NextRequest,
  namespace: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const now = Date.now();
  pruneRateBuckets(now);

  const key = `${namespace}:${getClientIp(req)}`;
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  bucket.count += 1;
  if (bucket.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
      },
    }
  );
}

export function isAllowedMint(mint: string): boolean {
  return MINT_REGEX.test(mint) && knownMints.has(mint);
}

export function isAllowedCoinGeckoId(id: string): boolean {
  return COINGECKO_ID_REGEX.test(id) && knownCoinGeckoIds.has(id);
}
