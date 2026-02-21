import {
  Connection,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  PublicKey,
  AddressLookupTableAccount,
  SystemProgram,
} from "@solana/web3.js";
import { JITO_BLOCK_ENGINE_URLS, JITO_TIP_ACCOUNTS, JITO_TIP_LAMPORTS } from "../constants";
import { JupiterSwapInstructionsResponse } from "./jupiter";

function deserializeInstruction(
  instruction: {
    programId: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: string;
  }
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: Buffer.from(instruction.data, "base64"),
  });
}

async function getAddressLookupTableAccounts(
  connection: Connection,
  addresses: string[]
): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];

  const results = await Promise.all(
    addresses.map((addr) =>
      connection.getAddressLookupTable(new PublicKey(addr))
    )
  );

  return results
    .map((r) => r.value)
    .filter((v): v is AddressLookupTableAccount => v !== null);
}

export async function buildSwapTransaction(
  connection: Connection,
  swapInstructions: JupiterSwapInstructionsResponse,
  payerKey: PublicKey,
  blockhash: string
): Promise<VersionedTransaction> {
  const altAccounts = await getAddressLookupTableAccounts(
    connection,
    swapInstructions.addressLookupTableAddresses
  );

  const instructions: TransactionInstruction[] = [
    ...swapInstructions.computeBudgetInstructions.map(deserializeInstruction),
    ...swapInstructions.setupInstructions.map(deserializeInstruction),
    deserializeInstruction(swapInstructions.swapInstruction),
    ...(swapInstructions.cleanupInstruction
      ? [deserializeInstruction(swapInstructions.cleanupInstruction)]
      : []),
  ];

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(altAccounts);

  return new VersionedTransaction(messageV0);
}

export function buildJitoTipTransaction(
  payerKey: PublicKey,
  blockhash: string,
  tipLamports: number = JITO_TIP_LAMPORTS
): VersionedTransaction {
  const tipAccount = new PublicKey(
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
  );

  const instructions = [
    SystemProgram.transfer({
      fromPubkey: payerKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    }),
  ];

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}

export async function submitJitoBundle(
  signedTransactions: VersionedTransaction[]
): Promise<{ bundleId: string; endpoint: string }> {
  const serialized = signedTransactions.map((tx) =>
    Buffer.from(tx.serialize()).toString("base64")
  );

  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [serialized, { encoding: "base64" }],
  });

  // Try each regional endpoint in order — fallback on rate limit / error
  let lastError: string = "";
  for (const endpoint of JITO_BLOCK_ENGINE_URLS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      const result = await response.json();

      if (result.error) {
        const errMsg = JSON.stringify(result.error);
        // If rate limited or congested, try next endpoint
        if (
          errMsg.includes("rate limit") ||
          errMsg.includes("congested") ||
          errMsg.includes("globally rate limited")
        ) {
          lastError = errMsg;
          console.warn(`Jito endpoint ${endpoint} rate limited, trying next...`);
          continue;
        }
        throw new Error(`Jito bundle submission failed: ${errMsg}`);
      }

      return { bundleId: result.result, endpoint };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Jito bundle submission failed")) {
        throw err;
      }
      lastError = err instanceof Error ? err.message : "Unknown error";
      console.warn(`Jito endpoint ${endpoint} failed: ${lastError}, trying next...`);
      continue;
    }
  }

  throw new Error(`All Jito endpoints failed. Last error: ${lastError}`);
}

export async function pollBundleStatus(
  bundleId: string,
  endpoint: string,
  maxRetries: number = 30,
  intervalMs: number = 2000
): Promise<{ status: "landed" | "failed"; slot?: number }> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBundleStatuses",
          params: [[bundleId]],
        }),
      });

      const result = await response.json();
      const statuses = result?.result?.value;

      if (statuses && statuses.length > 0) {
        const bundleStatus = statuses[0];
        if (
          bundleStatus.confirmation_status === "confirmed" ||
          bundleStatus.confirmation_status === "finalized"
        ) {
          return { status: "landed", slot: bundleStatus.slot };
        }
      }
    } catch {
      // Network error on poll — continue retrying
      console.warn(`Poll attempt ${i + 1} failed, retrying...`);
    }
  }

  return { status: "failed" };
}
