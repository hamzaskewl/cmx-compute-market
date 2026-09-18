# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Inferred from the brief: Solana hackathon judges, crypto-native traders, and compute-market participants evaluating a working GPU-hour market prototype.

## Product Purpose

- Confirmed: expose GPU-hour reference indexes derived from Ornn data and make them usable as the reference layer for Solana markets.
- Confirmed: the immediate goal is a credible MVP that can be evaluated before any mainnet launch.

## Positioning

- Inferred from the implementation and brief: a compute-native market surface whose instruments are anchored to named GPU-hour indexes rather than generic crypto pairs.

## Operating Context

- Confirmed: the public web experience is hosted on Railway.
- Confirmed: Ornn OCPI is the external index source.
- Confirmed: the current public beta runs with test assets on Solana devnet; no mainnet funds are involved.
- Confirmed: cmB200 is the quote asset for permissionless Meteora Dynamic Bonding Curve markets, with DAMM v2 as the post-curve liquidity destination.
- Inferred: visitors first inspect current GPU-hour reference values, then assess the market mechanism and its real devnet history.

## Capabilities and Constraints

- Confirmed: display only values returned by the real Ornn feed; do not fabricate prices, percentage changes, balances, tokens, launches, liquidity, deployment status, or transaction activity.
- Confirmed: when no real data exists, omit the corresponding market content instead of substituting fixtures.
- Confirmed: cmB200 mint/redeem, permissionless B200-paired DBC launches, swap history, and the DAMM v2 migration path are deployed and exercised on devnet.
- Confirmed: DBC buys use Meteora `swap2` partial-fill mode so a boundary-crossing final buy spends only what the curve accepts and leaves the remainder in the wallet.
- Confirmed: migration readiness is determined by exact onchain reserve state (`quoteReserve >= migrationQuoteThreshold`), never by a rounded display percentage; when ready, any connected wallet may invoke the DAMM v2 migration fallback.
- Confirmed: user-facing cmB200 amounts include their current USD equivalent when the Ornn B200 reference is available.
- Open decision: production mint, reserve, liquidity, and redemption parameters are not yet confirmed.

## Brand Commitments

- Confirmed: the product is a branded compute-commodities exchange, inspired by the information clarity and authority of Commodities Market without copying its identity.
- Confirmed: GPU representations should be compact, very simple pixel or voxel marks with clear H100, H200, B200, A100, and RTX 5090 labels.
- Confirmed: avoid the incumbent CMX mark, oversized photoreal GPU art, ugly utility typography, and an unbranded generic-dashboard appearance.
- Confirmed: the experience should feel clean and simple without becoming sparse or anonymous.

## Evidence on Hand

- Real index endpoint: `app/api/indices/route.ts`, proxying Ornn daily index data.
- Checked-in devnet deployment: `deployment/devnet.json`, including the executable GPU-index program, cmB200 mint, Meteora DBC configuration, and a probe market with finalized transaction history.
- Market history: the server reconstructs swaps from onchain pool-vault balance deltas, receives pool logs over a server-owned Helius-compatible WebSocket, and independently reconciles recent confirmed-chain signatures before streaming deduplicated updates to browsers.
- Migration proof: a finish-review market completed permissionless devnet migration to DAMM v2 pool `F2ZVSu4jNv3NTY6DDx4UAjA611DnbdtbGVWA76Zt27QE`.
- Existing Solana implementation: `programs/gpu_market`, `lib/chain-client.ts`, `lib/dbc-markets.ts`, `lib/market-live.ts`, and devnet smoke coverage.
- User-supplied GPU reference images exist only as visual shape references; they are not proof of live inventory or market activity.
- No production mint, production liquidity, or mainnet market activity is represented by the current public beta.

## Product Principles

- Truth before density: a shorter page with real data is preferable to a fuller page with simulated activity.
- Make the reference asset legible before explaining the protocol around it.
- Treat each GPU index as an identifiable instrument, not decorative hardware photography.
- Present deployment and trading states only when the underlying system can verify them.
- Let exact onchain state govern transaction boundaries and migration; percentages and progress meters are explanatory displays only.
- Keep the visual system ownable enough to be recognized without the logo.
