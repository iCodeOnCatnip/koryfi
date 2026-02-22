import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BasketConfig } from "../baskets/types";
import {
  USDC_MINT,
  USDC_DECIMALS,
  USDT_MINT,
  USDT_DECIMALS,
  WSOL_MINT,
  SOL_DECIMALS,
  DEFAULT_SLIPPAGE_BPS,
  FEE_WALLET,
  PLATFORM_FEE_BPS,
} from "../constants";
import { getQuote, getMultipleQuotes, getSwapInstructions, JupiterQuoteResponse } from "./jupiter";
import {
  buildSwapTransaction,
  buildJitoTipTransaction,
  submitJitoBundle,
  pollBundleStatus,
} from "./bundleBuilder";

export interface SwapPreview {
  allocations: {
    symbol: string;
    mint: string;
    inputAmount: number;
    estimatedOutput: string;
    priceImpactPct: number;
    weight: number;
  }[];
  totalFeeAmount: number;
  netInputAmount: number;
  quotes: JupiterQuoteResponse[];
  inputSymbol: string;
}

export interface SwapResult {
  success: boolean;
  bundleId?: string;
  slot?: number;
  error?: string;
  txSignatures?: string[];
}

function getInputTokenMeta(mint: string): { symbol: string; decimals: number } {
  if (mint === USDC_MINT) return { symbol: "USDC", decimals: USDC_DECIMALS };
  if (mint === USDT_MINT) return { symbol: "USDT", decimals: USDT_DECIMALS };
  if (mint === WSOL_MINT) return { symbol: "SOL", decimals: SOL_DECIMALS };
  return { symbol: "TOKEN", decimals: USDC_DECIMALS };
}

export async function getSwapPreview(
  basket: BasketConfig,
  inputAmount: number,
  customWeights: Record<string, number> | null,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
  inputMint: string = USDC_MINT
): Promise<SwapPreview> {
  const weights = customWeights || Object.fromEntries(
    basket.allocations.map((a) => [a.mint, a.weight])
  );

  const { symbol, decimals } = getInputTokenMeta(inputMint);

  const feeAmount = inputAmount * (PLATFORM_FEE_BPS / 10_000);
  const netInputAmount = inputAmount - feeAmount;
  const netInputRaw = BigInt(Math.floor(netInputAmount * 10 ** decimals));

  const allocations = basket.allocations.map((alloc) => {
    const weight = weights[alloc.mint] ?? alloc.weight;
    const amountForToken = (netInputRaw * BigInt(weight)) / 100n;
    return {
      outputMint: alloc.mint,
      usdcAmount: amountForToken,
      symbol: alloc.symbol,
      weight,
    };
  });

  // Jupiter will error on amount=0 and on inputMint === outputMint (circular arbitrage).
  // Skip quote requests for 0-weight / 0-amount allocations, and for tokens that are
  // already the same as the input asset (no swap needed).
  const toQuote = allocations.filter(
    (a) => a.weight > 0 && a.usdcAmount > 0n && a.outputMint !== inputMint
  );

  // No platformFeeBps in Jupiter quote — we handle fees ourselves
  const quotes = await getMultipleQuotes(toQuote, inputMint, slippageBps);

  const quoteByMint = new Map<string, JupiterQuoteResponse>();
  for (let i = 0; i < toQuote.length; i++) {
    quoteByMint.set(toQuote[i].outputMint, quotes[i]);
  }

  const previewAllocations = allocations.map((alloc) => {
    const q = quoteByMint.get(alloc.outputMint);
    return {
      symbol: alloc.symbol,
      mint: alloc.outputMint,
      inputAmount: Number(alloc.usdcAmount) / 10 ** decimals,
      // If there's no quote (e.g. inputMint === outputMint), we treat this allocation as
      // "no-op": the user simply keeps that portion of the input asset.
      estimatedOutput: q?.outAmount ?? alloc.usdcAmount.toString(),
      priceImpactPct: q ? parseFloat(q.priceImpactPct) : 0,
      weight: alloc.weight,
    };
  });

  return {
    allocations: previewAllocations,
    totalFeeAmount: feeAmount,
    netInputAmount,
    quotes,
    inputSymbol: symbol,
  };
}

/**
 * Build a fee transfer transaction for the given mint.
 * Sends the platform fee from user's ATA to the fee wallet's ATA.
 */
function buildFeeTransaction(
  payerKey: PublicKey,
  feeAmountRaw: bigint,
  blockhash: string,
  mint: string
): VersionedTransaction | null {
  if (!FEE_WALLET || feeAmountRaw <= 0n) return null;

  const feeWalletPubkey = new PublicKey(FEE_WALLET);
  const mintPubkey = new PublicKey(mint);

  const userAta = getAssociatedTokenAddressSync(mintPubkey, payerKey);
  const feeAta = getAssociatedTokenAddressSync(mintPubkey, feeWalletPubkey);

  const instructions = [
    // Create fee wallet's ATA if it doesn't exist (idempotent — no-op if exists)
    createAssociatedTokenAccountIdempotentInstruction(
      payerKey,
      feeAta,
      feeWalletPubkey,
      mintPubkey,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ),
    createTransferInstruction(
      userAta,
      feeAta,
      payerKey,
      feeAmountRaw,
      [],
      TOKEN_PROGRAM_ID
    ),
  ];

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}

/**
 * Helper: build all transactions (fee + swaps + optional tip) from swap instructions.
 */
async function buildAllTransactions(
  connection: Connection,
  swapInstructionSets: Awaited<ReturnType<typeof getSwapInstructions>>[],
  payerKey: PublicKey,
  feeAmount: number,
  includeTip: boolean,
  inputMint: string
) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const { decimals } = getInputTokenMeta(inputMint);
  const feeAmountRaw = BigInt(Math.floor(feeAmount * 10 ** decimals));
  const feeTx = buildFeeTransaction(payerKey, feeAmountRaw, blockhash, inputMint);

  const swapTxs = await Promise.all(
    swapInstructionSets.map((instrSet) =>
      buildSwapTransaction(connection, instrSet, payerKey, blockhash)
    )
  );

  const coreTxs = [...(feeTx ? [feeTx] : []), ...swapTxs];

  if (includeTip) {
    const tipTx = buildJitoTipTransaction(payerKey, blockhash);
    return {
      allTxs: [...coreTxs, tipTx],
      coreTxCount: coreTxs.length,
      blockhash,
      lastValidBlockHeight,
    };
  }

  return {
    allTxs: coreTxs,
    coreTxCount: coreTxs.length,
    blockhash,
    lastValidBlockHeight,
  };
}

/** Returns true if the error is an explicit wallet rejection by the user (not a network failure). */
function isUserRejection(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("rejected the request")
  );
}

export async function executeBasketBuy(
  connection: Connection,
  wallet: {
    publicKey: PublicKey;
    signAllTransactions: (
      txs: VersionedTransaction[]
    ) => Promise<VersionedTransaction[]>;
  },
  quotes: JupiterQuoteResponse[],
  feeAmount: number
): Promise<SwapResult> {
  if (quotes.length === 0) {
    return { success: false, error: "No quotes provided" };
  }
  try {
    const inputMint = quotes[0].inputMint;
    // Get swap instructions for each quote
    const swapInstructionSets = await Promise.all(
      quotes.map((quote) =>
        getSwapInstructions(quote, wallet.publicKey.toString())
      )
    );

    // === Attempt 1: RPC Send (fast, single sign) ===
    try {
      const { allTxs: rpcTxs, blockhash, lastValidBlockHeight } =
        await buildAllTransactions(
          connection,
          swapInstructionSets,
          wallet.publicKey,
          feeAmount,
          false,
          inputMint
        );

      const signedRpcTxs = await wallet.signAllTransactions(rpcTxs);
      const txSignatures: string[] = [];

      for (const tx of signedRpcTxs) {
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        txSignatures.push(sig);
      }

      // Confirm all transactions concurrently (swaps are independent)
      const confirmations = await Promise.all(
        txSignatures.map((sig) =>
          connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            "confirmed"
          )
        )
      );
      const failedIdx = confirmations.findIndex((c) => c.value.err);
      if (failedIdx !== -1) {
        throw new Error(
          `Transaction ${failedIdx + 1} failed: ${JSON.stringify(confirmations[failedIdx].value.err)}`
        );
      }

      return { success: true, txSignatures };
    } catch (rpcError) {
      if (isUserRejection(rpcError)) throw rpcError; // user cancelled — don't prompt again via Jito
      console.warn(
        "RPC send failed, falling back to Jito bundle:",
        rpcError instanceof Error ? rpcError.message : rpcError
      );
    }

    // === Attempt 2: Jito Bundle fallback (atomic, fresh blockhash + re-sign) ===
    try {
      const { allTxs } = await buildAllTransactions(
        connection,
        swapInstructionSets,
        wallet.publicKey,
        feeAmount,
        true,
        inputMint
      );

      const signedTxs = await wallet.signAllTransactions(allTxs);
      const { bundleId, endpoint } = await submitJitoBundle(signedTxs);
      const result = await pollBundleStatus(bundleId, endpoint);

      if (result.status === "landed") {
        return { success: true, bundleId, slot: result.slot };
      }

      return {
        success: false,
        bundleId,
        error: "Both RPC and Jito bundle failed. Please try again.",
      };
    } catch (jitoError) {
      return {
        success: false,
        error: `Both RPC and Jito failed. Last error: ${
          jitoError instanceof Error ? jitoError.message : "Unknown error"
        }`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

export async function executeBasketSell(
  connection: Connection,
  wallet: {
    publicKey: PublicKey;
    signAllTransactions: (
      txs: VersionedTransaction[]
    ) => Promise<VersionedTransaction[]>;
  },
  sellAmounts: { inputMint: string; amount: string }[],
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): Promise<SwapResult> {
  try {
    const quotes = await Promise.all(
      sellAmounts
        .filter((s) => { try { return BigInt(s.amount) > 0n; } catch { return false; } })
        .map((s) => getQuote(s.inputMint, USDC_MINT, s.amount, slippageBps))
    );

    const swapInstructionSets = await Promise.all(
      quotes.map((quote) =>
        getSwapInstructions(quote, wallet.publicKey.toString())
      )
    );

    // Helper to build sell transactions (swaps only, no fee collection on sell)
    const buildSellTransactions = async (includeTip: boolean) => {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const swapTxs = await Promise.all(
        swapInstructionSets.map((instrSet) =>
          buildSwapTransaction(connection, instrSet, wallet.publicKey, blockhash)
        )
      );

      if (includeTip) {
        const tipTx = buildJitoTipTransaction(wallet.publicKey, blockhash);
        return { allTxs: [...swapTxs, tipTx], blockhash, lastValidBlockHeight };
      }

      return { allTxs: swapTxs, blockhash, lastValidBlockHeight };
    };

    // === Attempt 1: RPC Send (fast, single sign) ===
    try {
      const { allTxs: rpcTxs, blockhash, lastValidBlockHeight } =
        await buildSellTransactions(false);

      const signedRpcTxs = await wallet.signAllTransactions(rpcTxs);
      const txSignatures: string[] = [];

      for (const tx of signedRpcTxs) {
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        txSignatures.push(sig);
      }

      // Confirm all transactions concurrently (swaps are independent)
      const confirmations = await Promise.all(
        txSignatures.map((sig) =>
          connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            "confirmed"
          )
        )
      );
      const failedIdx = confirmations.findIndex((c) => c.value.err);
      if (failedIdx !== -1) {
        throw new Error(
          `Transaction ${failedIdx + 1} failed: ${JSON.stringify(confirmations[failedIdx].value.err)}`
        );
      }

      return { success: true, txSignatures };
    } catch (rpcError) {
      if (isUserRejection(rpcError)) throw rpcError; // user cancelled — don't prompt again via Jito
      console.warn(
        "RPC send failed, falling back to Jito bundle:",
        rpcError instanceof Error ? rpcError.message : rpcError
      );
    }

    // === Attempt 2: Jito Bundle fallback (atomic, fresh blockhash + re-sign) ===
    try {
      const { allTxs } = await buildSellTransactions(true);
      const signedTxs = await wallet.signAllTransactions(allTxs);
      const { bundleId, endpoint } = await submitJitoBundle(signedTxs);
      const result = await pollBundleStatus(bundleId, endpoint);

      if (result.status === "landed") {
        return { success: true, bundleId, slot: result.slot };
      }

      return {
        success: false,
        bundleId,
        error: "Both RPC and Jito bundle failed. Please try again.",
      };
    } catch (jitoError) {
      return {
        success: false,
        error: `Both RPC and Jito failed. Last error: ${
          jitoError instanceof Error ? jitoError.message : "Unknown error"
        }`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
