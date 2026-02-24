import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

type RedemptionRecord = {
  code: string;
  fingerprintHash: string;
  ip: string;
  redeemedAt: string;
};

type RedemptionStore = Record<string, RedemptionRecord>;

const STORE_PATH = path.join(process.cwd(), ".access-redemptions.json");
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_ENABLED = Boolean(REDIS_URL && REDIS_TOKEN);
const REDIS_PREFIX = "koryfi:access";

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
  try {
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Vercel filesystem is read-only outside /tmp.
    const tmpStorePath = path.join(os.tmpdir(), "koryfi-access-redemptions.json");
    await fs.writeFile(tmpStorePath, JSON.stringify(store, null, 2), "utf8");
  }
}

async function redisCommand(parts: (string | number)[]): Promise<unknown> {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Redis not configured");
  }
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([parts]),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redis command failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as Array<{ result?: unknown }>;
  return data?.[0]?.result;
}

function redisCodeKey(code: string): string {
  return `${REDIS_PREFIX}:code:${code}`;
}

function redisFingerprintKey(fingerprintHash: string): string {
  return `${REDIS_PREFIX}:fp:${fingerprintHash}`;
}

export function getAllowedCodes(): string[] {
  return parseAllowedCodes();
}

export async function getRedemptionByFingerprint(
  fingerprint: string
): Promise<RedemptionRecord | null> {
  const fingerprintHash = hashFingerprint(fingerprint);
  if (REDIS_ENABLED) {
    const code = (await redisCommand(["GET", redisFingerprintKey(fingerprintHash)])) as
      | string
      | null;
    if (!code) return null;
    const raw = (await redisCommand(["GET", redisCodeKey(code)])) as string | null;
    if (!raw) return null;
    return JSON.parse(raw) as RedemptionRecord;
  }

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

  if (REDIS_ENABLED) {
    const existingRaw = (await redisCommand(["GET", redisCodeKey(code)])) as string | null;
    if (existingRaw) {
      const existingRecord = JSON.parse(existingRaw) as RedemptionRecord;
      if (existingRecord.fingerprintHash === fingerprintHash) {
        return { ok: true, record: existingRecord, reused: true };
      }
      return { ok: false, reason: "already_used" };
    }

    const record: RedemptionRecord = {
      code,
      fingerprintHash,
      ip: params.ip,
      redeemedAt: new Date().toISOString(),
    };

    await redisCommand(["SET", redisCodeKey(code), JSON.stringify(record)]);
    await redisCommand(["SET", redisFingerprintKey(fingerprintHash), code]);
    return { ok: true, record, reused: false };
  }

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

