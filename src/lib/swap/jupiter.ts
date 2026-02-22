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

  const requestQuote = (withKey: boolean) =>
    fetch(`${JUPITER_QUOTE_API}?${params}`, {
      headers: {
        ...(withKey && JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
      },
    });

  let response = await requestQuote(true);
  if ((response.status === 401 || response.status === 403) && JUPITER_API_KEY) {
    // If configured key is invalid/expired, fall back to public endpoint.
    response = await requestQuote(false);
  }

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

  const requestSwap = (withKey: boolean) =>
    fetch(JUPITER_SWAP_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(withKey && JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
      },
      body: JSON.stringify(body),
    });

  let response = await requestSwap(true);
  if ((response.status === 401 || response.status === 403) && JUPITER_API_KEY) {
    // If configured key is invalid/expired, fall back to public endpoint.
    response = await requestSwap(false);
  }

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
