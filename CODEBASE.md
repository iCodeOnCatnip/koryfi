# solana-baskets Project Context

## Stack
- Next.js 16 app-router, TypeScript, Tailwind CSS v4, shadcn/ui
- Solana wallet-adapter (Phantom, Solflare), Jupiter lite-api, Jito bundles, Pyth Hermes
- Upstash Redis REST (shared chart cache + access code store + purchase history)
- No backend DB — primary state in localStorage; server-side files/Redis for sync

---

## API Keys & Environment Variables
| Variable | Where used | Exposure |
|---|---|---|
| `HELIUS_API_KEY` | `/api/balances`, `/api/solana-rpc` URL | Server-side only |
| `UPSTASH_REDIS_REST_URL` | chart cache, access store, purchase history | Server-side only |
| `UPSTASH_REDIS_REST_TOKEN` | same | Server-side only |
| `ACCESS_CODES` | access gate — comma-separated list | Server-side only |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | unused (SolanaProvider uses window.location.origin proxy) | N/A |

No client-side API keys. Jupiter lite-api requires no key. Helius RPC accessed only via server proxy at `/api/solana-rpc`.

---

## Key File Map
```
src/
  app/
    page.tsx                    # Landing: CursorTrail, hero, CTA buttons (no scroll, 100dvh)
    layout.tsx                  # Root layout: Solana providers, custom fonts, HeaderNav
    baskets/page.tsx            # Basket list + repeat-investment modal + TourModal + BridgeFab
    basket/[id]/page.tsx        # Basket detail: PieChart, PerformanceChart, TxHistory, SwapPanel
    dashboard/page.tsx          # Dashboard: portfolio pie, metrics, investment history tabs
    providers.tsx               # Client providers: Buffer polyfill + SolanaProvider
    api/
      chart/route.ts            # Historical chart: Upstash > in-memory > disk; CoinGecko live-tail fallback
      prices/route.ts           # Live prices: Pyth → Jupiter → CoinGecko fallback; last-known fallback
      marketcap/route.ts        # Market cap weights: CoinGecko, weekly cache, disk-based
      coingecko/route.ts        # CG proxy: serialized queue (2s gaps), 24h in-memory cache
      balances/route.ts         # Helius v1 /wallet/{address}/balances — returns { totalUsdValue }
      solana-rpc/route.ts       # RPC proxy: method allowlist (15 methods), 512KB size limit, Helius → public fallback
      purchase-history/route.ts # GET/POST purchase records per wallet (Redis + file fallback)
      access/
        redeem/route.ts         # POST: redeem access code (rate-limited 5/min/IP)
        status/route.ts         # GET: check if fingerprint is already redeemed
  components/
    access/BasketsAccessGate.tsx  # Client gate: localStorage flag + fingerprint + code modal
    swap/SwapPanel.tsx          # Invest UI: weight mode, sliders, amount input, preview, invest button
    charts/PerformanceChart.tsx # SVG line chart: geometry+tokenPerf memoized, hover via html div
    baskets/BasketCard.tsx      # Card: name, description, allocation columns, "Explore" CTA
    layout/HeaderNav.tsx        # Nav pill; pointer-events-none wrapper, pointer-events-auto on pill
    wallet/ConnectButton.tsx    # Connect/disconnect with address copy
    bridge/BridgeFab.tsx        # Wormhole Connect FAB, dynamically imported (no SSR)
    TourModal.tsx               # createPortal to document.body, reads sessionStorage, useRef flag
  lib/
    baskets/config.ts           # BASKETS[], getBasketById()
    baskets/types.ts            # BasketConfig, TokenAllocation, PurchaseRecord, WeightMode
    constants.ts                # Mints, Jupiter lite-api endpoints, Jito URLs/tips, FEE_WALLET
    access/store.ts             # Code validation, fingerprint hashing, Redis+file redemption store
    portfolio/history.ts        # localStorage CRUD: savePurchaseRecord (fires custom event), sync
    portfolio/store.ts          # Server-side purchase history: Redis + file fallback
    server/security.ts          # enforceRateLimit, getClientIp, isAllowedMint, isAllowedCoinGeckoId
    swap/
      swapExecutor.ts           # getSwapPreview(), executeBasketBuy() (RPC→Jito fallback), executeBasketSell()
      jupiter.ts                # getQuote(), getMultipleQuotes(), getSwapInstructions(); 401/403 retry
      bundleBuilder.ts          # buildSwapTransaction(), Jito bundle submit + poll
  hooks/
    usePrices.ts                # Shared global singleton: polls /api/prices every 30s; pub-sub Set
    useSwapPreview.ts           # Polls getSwapPreview() every 4s; cancellation + rate-limit retry
  providers/
    SolanaProvider.tsx          # Phantom+Solflare adapters; RPC = window.origin/api/solana-rpc
scripts/
  prefetch-charts.ts            # Prebuild: Pyth+CG in parallel; writes .chart-cache + Upstash keys
```

---

## Baskets (lib/baskets/config.ts)
- **blue-chip**: BTC(34%), ETH(33%), SOL(33%) — all Pyth
- **sol-staking**: mSOL, jitoSOL (Pyth); pSOL, hSOL, bonkSOL (CoinGecko) — 5-way equal
- **sunrise**: HYPE, LIT, MON, INX — all CoinGecko, 4-way equal
- **global-market**: QQQx(34%), XAUT0(33%) CoinGecko; BTC(33%) Pyth
- **sol-defi**: JUP, KMNO, CLOUD, JTO, RAY, DRIFT, MET — all Pyth, 7-way ~14%

---

## Core Types
```ts
TokenAllocation { symbol, mint, weight, marketCapWeight, coingeckoId, pythPriceId?, decimals, icon }
BasketConfig    { id, name, description, icon, allocations[], defaultWeightMode, disableMarketcap?, createdAt }
PurchaseRecord  { id, basketId, timestamp, usdcInvested, weights, allocations[], bundleId, txSignatures[] }
  allocations:  { mint, symbol, ratio (0-1 share), priceAtPurchase }
WeightMode = "marketcap" | "equal" | "custom"
```

---

## Access Gate System
Prevents unauthorized access to the baskets/invest UI. Every page wraps content in `<BasketsAccessGate>`.

### Client flow (BasketsAccessGate.tsx)
1. On mount: check localStorage key `koryfi_access_granted_v1` = "1"
2. If not set: GET `/api/access/status?fingerprint=<fp>` → if `{ allowed: true }`, set flag and show content
3. If still not allowed: show modal overlay with code input

### Code input modal
- Input auto-uppercases
- POST `/api/access/redeem` `{ code, fingerprint }` (rate-limited: 5/min/IP)
- 401 → "Invalid access code"
- 409 → "Code already tied to another device"
- Success → set localStorage flag, show content

### Fingerprint
- Key `koryfi_access_fingerprint_v1` in localStorage
- Generated once: `crypto.randomUUID()` or `${Date.now()}-${Math.random()}`
- SHA256-hashed server-side before storing — raw fingerprint never persisted

### Server store (lib/access/store.ts)
- `ACCESS_CODES` env var: comma-separated list, normalized to uppercase
- `redeemCode({ code, fingerprint, ip })`:
  1. Check code against allowed list → `invalid_code` if not found
  2. Redis: GET `koryfi:access:code:{CODE}` → if exists, compare fingerprint hash
  3. Same hash → `{ ok: true, reused: true }`; different → `already_used`
  4. New → SET both `code:CODE` and `fp:HASH` keys; fallback to JSON file on Redis error
- File paths: `.access-redemptions.json` (primary) → `/tmp/koryfi-access-redemptions.json` (Vercel fallback)

---

## RPC Proxy (api/solana-rpc/route.ts)
Hides `HELIUS_API_KEY` from browser. Client always calls `/api/solana-rpc`.

**Security layers:**
- Rate limit: 1500 req/min/IP (disabled in dev)
- Request size limit: 512 KB (via `Content-Length` header check)
- **Method allowlist** (15 methods): `getBalance`, `getAccountInfo`, `getRecentBlockhash`, `getLatestBlockhash`, `getFeeForMessage`, `getSignatureStatuses`, `getTransaction`, `sendRawTransaction`, `simulateTransaction`, `getParsedTokenAccountsByOwner`, `getTokenAccountBalance`, `getSlot`, `getBlockTime`, `getMinimumBalanceForRentExemption`
- Supports batch JSON-RPC (array payload)
- `x-rpc-upstream` header only emitted in development
- Helius → public mainnet fallback on 401/403

---

## Purchase History System
Dual-layer: localStorage (instant) + server (cross-device sync).

### Client (lib/portfolio/history.ts)
- `savePurchaseRecord(wallet, record)`: writes localStorage → dispatches `CustomEvent("koryfi:purchase-saved", { detail: { walletPubkey, basketId } })` → async POST to `/api/purchase-history` (keepalive: true, best-effort)
- `getPurchaseRecords(wallet)`: reads + migrates localStorage, returns []
- `getPurchaseRecordsSynced(wallet)`: fetches server records, merges by id, saves merged to localStorage
- `getVisibleSwapSignatures(record)`: skips fee tx (index 0 when len > allocations.len)

### Server (lib/portfolio/store.ts)
- `getWalletPurchaseRecords(wallet)` / `appendWalletPurchaseRecord(wallet, record)`
- Redis key: `koryfi:history:wallet:{wallet}` → JSON PurchaseRecord[]
- File fallback: `.purchase-history.json` → `/tmp/koryfi-purchase-history.json`
- Records deduped by `id` on append

### Real-time refresh
`TxHistory` listens to `window.addEventListener("koryfi:purchase-saved", ...)` and reloads if wallet + basketId match. Fires immediately after a swap completes on any page.

---

## Wallet Balance (api/balances/route.ts)
- Uses Helius v1 endpoint: `GET /v1/wallet/{address}/balances?api-key=...`
- Returns `{ totalUsdValue }` — Helius prices ALL tokens (USDC, USDT, NFTs, SPL) natively
- 30s in-memory cache per address
- Address validated with base58 regex before use
- Dashboard shows "Unable to load" (red) if fetch fails, "Loading..." while pending

---

## Swap Flow
1. `getSwapPreview(basket, amount, weights, slippageBps, inputMint)` → per-token Jupiter quotes + total fee
2. `executeBasketBuy(connection, wallet, quotes, feeAmount)`:
   - Attempt 1: RPC `sendRawTransaction` (no tip)
   - If fails → Attempt 2: Jito bundle (adds tip tx at index 0)
   - `isUserRejection()` guard: wallet cancel detected → rethrows immediately, skips Jito
3. Fee tx is always `txSignatures[0]` → skip with `.slice(1)` on display (or use `getVisibleSwapSignatures`)

### Token Amount Rule (CRITICAL)
- Jupiter `outAmount` = RAW units → divide by `10 ** decimals`
- `PurchaseRecord.allocations[].priceAtPurchase` = human-readable — do NOT divide again
- `TokenAllocation.decimals` is source of truth

---

## UI Modals & State Machines

### Repeat Investment Modal (baskets/page.tsx + basket/[id]/page.tsx)
Both pages have identical modal with these states:
- `"idle"` → show preview (estimated output per token)
- `"quoting"` → spinner "Getting quotes..."
- `"signing"` → spinner "Waiting for signature..."
- `"submitting"` → spinner "Submitting..."
- `"success"` → large "Investment successful", "You may close the window.", full-width "Go to history" button
- `"error"` → error message with retry option

Preview: fetched fresh on modal open (`getSwapPreview()`), shows per-token output rows.

### Access Code Modal (BasketsAccessGate.tsx)
- Shown when `!allowed && ready`
- z-index 999, full viewport overlay
- Code input (auto-uppercase), submit button, error display

### SwapPanel (components/swap/SwapPanel.tsx)
- Weight mode tabs: Equal / Custom / Market Cap (Market Cap hidden if `basket.disableMarketcap`)
- Custom mode: per-token sliders (5–90 range) with lock toggle; `lockedMints` as Set; `lockedMintsKey` (sorted join) used in `updateWeight` deps for stable memoization
- Amount input with USDC/SOL toggle
- "Invest" button → triggers swap flow with same state machine as repeat modal
- `rebuyInFlight = useRef(false)` sync guard prevents double-trigger

---

## Progressive Loading (basket/[id]/page.tsx)
- `CHART_DEFER_MS = 250`: PerformanceChart mounts after 250ms delay (shows skeleton)
- `INVEST_PANEL_DEFER_MS = 200`: SwapPanel mounts after 200ms (also triggers on panel `mouseenter`)
- `usePrices({ paused: !isInvestPanelReady })`: price polling paused until panel ready
- Market cap weights: lazy-fetched only when `weightMode === "marketcap"` is selected, with `cancelled` flag guard

---

## Security Module (lib/server/security.ts)
- `enforceRateLimit(req, namespace, limit, windowMs)` → `NextResponse | null`
  - In-memory bucket map (max 5000, prunes expired on each call)
  - Key: `${namespace}:${clientIP}`
  - Returns 429 + `Retry-After` header if exceeded
- `isAllowedMint(mint)` — base58 regex + presence in BASKETS allocations (built at module level)
- `isAllowedCoinGeckoId(id)` — slug regex + presence in BASKETS
- `MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/`

### Rate limits per endpoint
| Endpoint | Limit |
|---|---|
| `/api/solana-rpc` | 1500/min (dev: unlimited) |
| `/api/access/redeem` | 5/min |
| `/api/balances` | 40/min |
| `/api/prices` | 120/min |
| `/api/chart` | 20/min |
| `/api/coingecko` | 30/min |
| `/api/marketcap` | 30/min |

---

## Price System
### usePrices hook (hooks/usePrices.ts)
- Global singleton (module-level): `subscribers` Set, `sharedPrices`, `sharedLoading`, `pollHandle`
- Components subscribe via `setSnapshot` stable ref — properly cleaned up on unmount
- Paused flag: stops adding to `activePollingSubscribers`, polling stops if no active subscribers
- `ALL_MINTS` built at module level from BASKETS config

### prices route (api/prices/route.ts)
- Fallback chain: Pyth Hermes → Jupiter → CoinGecko simple price
- Last-known in-memory cache for transient provider outages
- Unknown mints silently filtered (not rejected)
- Jupiter: lite-api.jup.ag, 401/403 retry without api-key (jupiter.ts)

---

## localStorage Keys
- `basket_purchases_${walletPubkey}` → PurchaseRecord[]
- `custom_weights_v2_${walletPubkey}_${basketId}` → Record<string, number>
- `koryfi_access_granted_v1` → "1" if access granted
- `koryfi_access_fingerprint_v1` → browser UUID fingerprint

---

## API Route Patterns
- All external fetches use `fetchWithTimeout(url, init?)` — AbortController + setTimeout (8–15s), clears in `.finally()`
- All user-supplied IDs/mints validated before use (regex + allowlist)
- No upstream errors, URLs, or keys leaked to client responses
- `coingecko/route.ts`: serialized queue with `fetchWithRetry`, per-attempt AbortController

---

## Known Fixes Applied (notable)
- Pyth `0x` prefix: strip with `.replace("0x","")` before using as map key
- Jito double-popup: `isUserRejection()` catches wallet cancel → skips Jito fallback
- `swapExecutor.ts`: signature normalization + validation before polling; invalid sig = explicit error
- `constants.ts`: Jupiter endpoints → `lite-api.jup.ag`
- `basket/[id]/page.tsx`: progressive loading permanent
- `HeaderNav.tsx`: pointer-events-none wrapper fix
- `purchase-history/route.ts`: base58 regex validation (not length-only)
- `solana-rpc/route.ts`: method allowlist + 512KB size limit + no upstream header in prod
