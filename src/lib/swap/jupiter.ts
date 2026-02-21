import {
  JUPITER_QUOTE_API,
  JUPITER_SWAP_API,
  JUPITER_API_KEY,
  MAX_ACCOUNTS_PER_SWAP,
} from "../constants";

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: { amount: string; feeBps: number } | null;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot: number;
  timeTaken: number;
}

export interface JupiterSwapInstructionsResponse {
  tokenLedgerInstruction: unknown | null;
  computeBudgetInstructions: SerializedInstruction[];
  setupInstructions: SerializedInstruction[];
  swapInstruction: SerializedInstruction;
  cleanupInstruction: SerializedInstruction | null;
  addressLookupTableAddresses: string[];
}

interface SerializedInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number
): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
    maxAccounts: MAX_ACCOUNTS_PER_SWAP.toString(),
    restrictIntermediateTokens: "true",
    excludeDexes: "HumidiFi",
  });

  const response = await fetch(`${JUPITER_QUOTE_API}?${params}`, {
    headers: {
      ...(JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter quote failed: ${error}`);
  }
  return response.json();
}

export async function getSwapInstructions(
  quoteResponse: JupiterQuoteResponse,
  userPublicKey: string,
  feeAccount?: string
): Promise<JupiterSwapInstructionsResponse> {
  const body: Record<string, unknown> = {
    quoteResponse,
    userPublicKey,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: { maxBps: 300 },
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: 1_000_000, // Cap at 0.001 SOL (~$0.09) per tx
        priorityLevel: "high",
      },
    },
  };

  if (feeAccount) {
    body.feeAccount = feeAccount;
  }

  const response = await fetch(JUPITER_SWAP_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter swap instructions failed: ${error}`);
  }
  return response.json();
}

export async function getMultipleQuotes(
  allocations: { outputMint: string; usdcAmount: bigint }[],
  inputMint: string,
  slippageBps: number
): Promise<JupiterQuoteResponse[]> {
  const quotes = await Promise.all(
    allocations.map((alloc) =>
      getQuote(
        inputMint,
        alloc.outputMint,
        alloc.usdcAmount.toString(),
        slippageBps
      )
    )
  );
  return quotes;
}
