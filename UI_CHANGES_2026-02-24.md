# UI Changes Summary (2026-02-24)

## Scope
- Local UI refactor and access-gate updates.
- Brand assets preserved (logo, fonts, core palette, button style system).

## Homepage Layout
- Navbar changed from full-width bar to a centered, floating pill container.
- Navbar uses glass styling with subtle white tint, blur, rounded corners, and border.
- Navbar remains fixed near top with logo on left and landing CTA on right.

## Hero Section
- Hero moved to single-column, center-aligned composition.
- Headline remains the same copy, now larger (`53px/65px/77px` breakpoints).
- Supporting copy is consolidated into one line with smaller text sizing.
- `self-custodial` remains highlighted with existing accent styling and tooltip.
- Removed line: `Crypto isn't easy, KoryFi is.`
- CTAs are centered under subheading:
  - Primary: `Invest in 28 seconds`
  - Secondary: `Take a tour ->` (normalized rendering for arrow)

## Spacing and Viewport Fit
- Vertical spacing was rebalanced between heading, subheading, CTAs, and preview.
- Homepage is constrained to one viewport (no homepage scrollbar).
- Tutorial preview section is moved up and sized to fit within viewport layout.

## Tutorial Preview / Modal
- Preview remains wrapped in a dark glass teaser container (rounded + border + blur).
- Tutorial modal kept at 2:1 ratio and increased in size.
- Current modal container size: `w-[min(99.5vw,1760px)] aspect-[2/1]`.

## Baskets Access Gate (New)
- Added a blocking popup on `/baskets` that requires an access code.
- Each code is one-device/browser only:
  - Code is bound to a browser fingerprint.
  - First redeem locks the code to that fingerprint.
  - Reuse on a different device/browser is rejected.
- IP is recorded server-side at redemption time.
- Redemption store is persisted locally in `.access-redemptions.json`.
- `.access-redemptions.json` is ignored in git.
- Fallback code format updated from sequential (`0001`) to random 4-char alphanumeric suffixes.

## Generated Access Codes (50)
- `KORY-ACCESS-9OQN`
- `KORY-ACCESS-NIJG`
- `KORY-ACCESS-DO39`
- `KORY-ACCESS-P4BJ`
- `KORY-ACCESS-X97J`
- `KORY-ACCESS-TBHW`
- `KORY-ACCESS-PS7N`
- `KORY-ACCESS-B2UX`
- `KORY-ACCESS-P7KV`
- `KORY-ACCESS-68G6`
- `KORY-ACCESS-D12O`
- `KORY-ACCESS-ESJ3`
- `KORY-ACCESS-KNG1`
- `KORY-ACCESS-LV5A`
- `KORY-ACCESS-GI92`
- `KORY-ACCESS-O5FA`
- `KORY-ACCESS-4DD5`
- `KORY-ACCESS-CP2V`
- `KORY-ACCESS-8PNV`
- `KORY-ACCESS-EQ50`
- `KORY-ACCESS-UAA7`
- `KORY-ACCESS-SWNP`
- `KORY-ACCESS-FJG1`
- `KORY-ACCESS-74FS`
- `KORY-ACCESS-WQA1`
- `KORY-ACCESS-KTAK`
- `KORY-ACCESS-YBVJ`
- `KORY-ACCESS-HCQC`
- `KORY-ACCESS-IVMJ`
- `KORY-ACCESS-2PAN`
- `KORY-ACCESS-MEBN`
- `KORY-ACCESS-T5AT`
- `KORY-ACCESS-SZ6J`
- `KORY-ACCESS-P59J`
- `KORY-ACCESS-G3G9`
- `KORY-ACCESS-DYSC`
- `KORY-ACCESS-615G`
- `KORY-ACCESS-SPDI`
- `KORY-ACCESS-908S`
- `KORY-ACCESS-GOJF`
- `KORY-ACCESS-0FTO`
- `KORY-ACCESS-2W44`
- `KORY-ACCESS-EJ3D`
- `KORY-ACCESS-1PRX`
- `KORY-ACCESS-K49Z`
- `KORY-ACCESS-55WZ`
- `KORY-ACCESS-NHFL`
- `KORY-ACCESS-OOKW`
- `KORY-ACCESS-VPXP`
- `KORY-ACCESS-RF6P`

## Files Updated (UI + Access)
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/components/TourLink.tsx`
- `src/components/TourModal.tsx`
- `src/app/baskets/page.tsx`
- `src/components/access/BasketsAccessGate.tsx`
- `src/app/api/access/status/route.ts`
- `src/app/api/access/redeem/route.ts`
- `src/lib/access/store.ts`
- `.gitignore`
- `src/components/home/CursorTrail.tsx`

## Homepage Cursor Trail (New)
- Added a homepage-only emerald glow cursor trail effect.
- Trail renders as a streak (not a dot) using multiple blurred segments.
- Trail appears while cursor is moving and fades out smoothly when idle.
- Idle fade-out duration set to ~1.5 seconds.
- Trail length increased to 44 segments.
- Disabled automatically on coarse pointers/touch devices.

