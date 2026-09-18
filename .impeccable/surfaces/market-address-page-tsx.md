---
version: 1
slug: "market-address-page-tsx"
primary_target: "app/markets/[address]/page.tsx"
related_targets: ["components/market-terminal.tsx","components/market-chart.tsx","app/market.module.css"]
---

# B200 launch market

Mode: Operate. Traders and judges must be able to inspect a specific cmB200-paired Meteora launch, understand its curve activity and current pool state, and execute a trade without returning to the home page.

## Direction contract

THESIS: A launch is a measured market instrument, not a promo card: price history, curve progress, swaps, reserves, token identity, and the trade ticket share one dense terminal.

OWN-WORLD: Preserve the Calibrated GPU Ledger—graphite sheets, cool charcoal rows, square controls, fine rules, dusty-periwinkle registration marks, Onest for product language, and Azeret Mono for prices, addresses, timestamps, and state.

STORY: The market header establishes token identity and cmB200 pairing; the first viewport puts real transaction-derived candlesticks beside a persistent buy/sell ticket; a continuously updating transaction tape sits directly under the chart; the lower register exposes creator and mint addresses, website, curve terms, and graduation status. The final curve buy may partially fill, unused cmB200 remains in the wallet, and completed curves expose an explicit DAMM v2 migration action before routing to the graduated pool.

CHART SOURCES: Keep the CMX first-party chart for pre-graduation launches, reconnect recovery, and auditable pool-delta candles. On mainnet, expose GMGN's documented embedded Solana chart as a second source tab for independent indexing and richer trader tooling. GMGN stays mainnet-only; never imply it can see a testnet mint.

FIRST VIEWPORT: Compact masthead, market identity strip, large candle/line chart with 1s, 3s, 5s, and 1m aggregation controls, narrow trade rail, and no generic hero. Keep provider and commitment detail out of persistent production chrome; use concise market or recovery copy only when it changes what the trader can do. Sparse markets show a precise empty state rather than fabricated candles.

FORM: Extend the approved calibrated-ledger direction into a pump/Axiom-style market terminal without copying their visual branding. Signature interaction: every swap updates the current OHLC candle and prepends the transaction tape in place while the chart crosshair and adjacent trade ticket remain spatially stable. Candle intervals are aggregation windows, not polling intervals.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

- Derive pre-graduation history from onchain token-balance deltas; do not invent candles, volume, holders, or market cap.
- Stream pool-mentioning transactions over a server-owned, Helius-compatible Solana WebSocket and independently reconcile recent confirmed-chain signatures on a timer. Deduplicate by transaction signature before emitting browser updates; never animate synthetic trades. Keep provider credentials server-only and out of `NEXT_PUBLIC_*` variables.
- Keep 1s, 3s, 5s, and 1m OHLC aggregation deterministic so the same swaps always produce the same bars.
- In sparse markets, carry the previous close into the next active bucket's open so the executed curve move remains visible; never add volume or synthetic trades to empty time buckets.
- Treat Meteora DBC as a virtual curve until migration. DexScreener compatibility begins at the real post-graduation pool.
- Calculate graduation from the exact quote-reserve threshold, never a rounded market-cap percentage. Use DBC `swap2` partial-fill mode for buys so a boundary-crossing order spends only the amount the curve can accept.
- When a curve reaches its exact threshold, expose a permissionless DAMM v2 migration action as a fallback to Meteora's migrator service. Once migrated, disable curve trading and route to the derived DAMM v2 pool.
- Show a USD equivalent directly beneath every user-facing numeric cmB200 amount. Keep live, verified, confirmed, devnet, provider, and commitment terminology in technical documentation rather than repetitive production UI chrome.
- Market logos are off-chain assets whose URL is stored in metadata; validate file type and size before upload.
- Preserve keyboard focus, mobile stacking, wallet-disconnected, loading, empty, pending, success, and recoverable-error states.
