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
- Access codes are now env-only via `ACCESS_CODES` (comma-separated), with no hardcoded fallback list in repo.

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
