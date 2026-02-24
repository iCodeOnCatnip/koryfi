export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

// Additional deposit tokens
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const USDT_DECIMALS = 6;

// Wrapped SOL mint (used for SOL deposits)
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;

// Use lite-api for broader unauthenticated compatibility; avoids intermittent 401s.
export const JUPITER_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
export const JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1/swap-instructions";

// Regional Jito endpoints — tried in order, fallback on rate limit
export const JITO_BLOCK_ENGINE_URLS = [
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://slc.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bPYoZ8IDk6u6cnECkASbBP",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSrRQDUSHi84CAS8jHe",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL6d33",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export const PLATFORM_FEE_BPS = 10; // 0.1% fee
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% slippage
export const MAX_ACCOUNTS_PER_SWAP = 20;
export const JITO_TIP_LAMPORTS = 10_000; // 0.00001 SOL

// Client connects via server-side proxy so HELIUS_API_KEY never appears in browser.
export const SOLANA_RPC_URL = "/api/solana-rpc";

// Fee collection wallet — override via NEXT_PUBLIC_FEE_WALLET env var if needed
export const FEE_WALLET =
  process.env.NEXT_PUBLIC_FEE_WALLET || "3zbi6PTctRZiQqaUYy9z6EMw528yecsQ9sUwgTXzJ5We";

// Jupiter API key — server-side only (used in /api/prices and jupiter.ts via server context)
export const JUPITER_API_KEY =
  process.env.JUPITER_API_KEY || "";
