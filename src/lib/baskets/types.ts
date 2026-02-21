export interface TokenAllocation {
  symbol: string;
  mint: string;
  weight: number;        // equal / default weight (0-100, sums to 100)
  marketCapWeight: number; // market-cap-derived weight (0-100, sums to 100)
  coingeckoId: string;
  pythPriceId?: string;
  decimals: number;
  icon: string;
}

export type WeightMode = "marketcap" | "equal" | "custom";

export interface BasketConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  allocations: TokenAllocation[];
  defaultWeightMode: WeightMode;
  disableMarketcap?: boolean; // hides the Market Cap weight mode option
  createdAt: string;
}

export interface BasketWithPrices extends BasketConfig {
  prices: Record<string, number>; // mint -> USD price
  totalValuePerUnit: number; // hypothetical $100 basket value
  change24h: number; // weighted 24h change
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: number;
  otherAmountThreshold: string;
  routePlan: unknown[];
}

export interface PurchaseRecord {
  id: string;
  basketId: string;
  timestamp: number;
  usdcInvested: number;
  weights: Record<string, number>; // custom weights used (kept for redo)
  allocations: {
    mint: string;
    symbol: string;
    ratio: number;           // 0–1 fraction of investedAmount
    priceAtPurchase: number; // USD per token at purchase time
  }[];
  bundleId: string;
  txSignatures: string[];
}
