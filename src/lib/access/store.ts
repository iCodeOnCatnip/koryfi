import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

type RedemptionRecord = {
  code: string;
  fingerprintHash: string;
  ip: string;
  redeemedAt: string;
};

type RedemptionStore = Record<string, RedemptionRecord>;

const STORE_PATH = path.join(process.cwd(), ".access-redemptions.json");

function parseAllowedCodes(): string[] {
  const raw = process.env.ACCESS_CODES?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function hashFingerprint(fingerprint: string): string {
  return createHash("sha256").update(fingerprint).digest("hex");
}

async function readStore(): Promise<RedemptionStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as RedemptionStore;
  } catch {
    return {};
  }
}

async function writeStore(store: RedemptionStore): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export function getAllowedCodes(): string[] {
  return parseAllowedCodes();
}

export async function getRedemptionByFingerprint(
  fingerprint: string
): Promise<RedemptionRecord | null> {
  const fingerprintHash = hashFingerprint(fingerprint);
  const store = await readStore();
  for (const record of Object.values(store)) {
    if (record.fingerprintHash === fingerprintHash) return record;
  }
  return null;
}

export async function redeemCode(params: {
  code: string;
  fingerprint: string;
  ip: string;
}): Promise<
  | { ok: true; record: RedemptionRecord; reused: boolean }
  | { ok: false; reason: "invalid_code" | "already_used" }
> {
  const code = normalizeCode(params.code);
  const allowedCodes = parseAllowedCodes();
  if (!allowedCodes.includes(code)) {
    return { ok: false, reason: "invalid_code" };
  }

  const store = await readStore();
  const existing = store[code];
  const fingerprintHash = hashFingerprint(params.fingerprint);

  if (existing) {
    if (existing.fingerprintHash === fingerprintHash) {
      return { ok: true, record: existing, reused: true };
    }
    return { ok: false, reason: "already_used" };
  }

  const record: RedemptionRecord = {
    code,
    fingerprintHash,
    ip: params.ip,
    redeemedAt: new Date().toISOString(),
  };
  store[code] = record;
  await writeStore(store);

  return { ok: true, record, reused: false };
}

