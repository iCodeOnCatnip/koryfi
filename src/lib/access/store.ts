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
    // Local fallback codes for development.
    return [
      "KORY-ACCESS-9OQN",
      "KORY-ACCESS-NIJG",
      "KORY-ACCESS-DO39",
      "KORY-ACCESS-P4BJ",
      "KORY-ACCESS-X97J",
      "KORY-ACCESS-TBHW",
      "KORY-ACCESS-PS7N",
      "KORY-ACCESS-B2UX",
      "KORY-ACCESS-P7KV",
      "KORY-ACCESS-68G6",
      "KORY-ACCESS-D12O",
      "KORY-ACCESS-ESJ3",
      "KORY-ACCESS-KNG1",
      "KORY-ACCESS-LV5A",
      "KORY-ACCESS-GI92",
      "KORY-ACCESS-O5FA",
      "KORY-ACCESS-4DD5",
      "KORY-ACCESS-CP2V",
      "KORY-ACCESS-8PNV",
      "KORY-ACCESS-EQ50",
      "KORY-ACCESS-UAA7",
      "KORY-ACCESS-SWNP",
      "KORY-ACCESS-FJG1",
      "KORY-ACCESS-74FS",
      "KORY-ACCESS-WQA1",
      "KORY-ACCESS-KTAK",
      "KORY-ACCESS-YBVJ",
      "KORY-ACCESS-HCQC",
      "KORY-ACCESS-IVMJ",
      "KORY-ACCESS-2PAN",
      "KORY-ACCESS-MEBN",
      "KORY-ACCESS-T5AT",
      "KORY-ACCESS-SZ6J",
      "KORY-ACCESS-P59J",
      "KORY-ACCESS-G3G9",
      "KORY-ACCESS-DYSC",
      "KORY-ACCESS-615G",
      "KORY-ACCESS-SPDI",
      "KORY-ACCESS-908S",
      "KORY-ACCESS-GOJF",
      "KORY-ACCESS-0FTO",
      "KORY-ACCESS-2W44",
      "KORY-ACCESS-EJ3D",
      "KORY-ACCESS-1PRX",
      "KORY-ACCESS-K49Z",
      "KORY-ACCESS-55WZ",
      "KORY-ACCESS-NHFL",
      "KORY-ACCESS-OOKW",
      "KORY-ACCESS-VPXP",
      "KORY-ACCESS-RF6P",
    ];
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

