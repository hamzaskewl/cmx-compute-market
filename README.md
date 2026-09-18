# CMX — Compute Market Exchange

CMX is a Solana MVP for launching and trading tokens paired with real GPU-hour
indexes. A composite pricing feed aggregates market inputs for H100, H200, B200,
A100, and RTX 5090 reference prices.

## What is implemented

- Live composite index feed with a five-minute cache.
- Oracle-priced cmB200 mint/redeem at a 0.30% fee.
- One 10,000 test-USDC faucet claim per wallet.
- Permissionless fixed-supply SPL launches on Meteora DBC, quoted in cmB200.
- A fixed 2.00% DBC trading fee, 100 cmB200 opening market cap, and 1,000
  cmB200 migration market cap.
- Final buys through Meteora `swap2` with `PartialFill`, so only the amount the
  curve can accept is spent and unused cmB200 stays in the wallet.
- Exact reserve-threshold graduation and a permissionless DAMM v2 migration
  fallback, with both creator and CMX liquidity permanently locked 50/50.
- Onchain swap history, live candle/line charts, transaction tape, and USD
  equivalents beneath user-facing numeric cmB200 values.
- Phantom wallet UI for devnet claims, cmB200 trades, launches, swaps, and
  migration.
- Railway-ready Next.js application and Docker image.

The oracle vault is intentionally one-sided: buys deposit test-USDC and mint the
GPU index, while sells burn the index and can redeem only against quote liquidity
already accumulated in that index vault. This reproduces the inexpensive MVP
mechanism without pretending the oracle alone creates a peg.

## Local development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Live B200 market data

Each Meteora DBC market page opens one server-side Solana WebSocket subscription
for that pool and shares it across connected browser sessions. A three-second
confirmed-chain reconciliation poll runs independently, so updates continue if
the WebSocket is throttled or disconnected. Swaps are reconstructed from
pool-vault balance deltas, deduplicated by transaction signature, streamed to
the browser over Server-Sent Events, and deterministically aggregated into
1-second, 3-second, 5-second, or 1-minute OHLC candles. In sparse markets, the
next active candle carries the previous executed close as its open; empty time
buckets never receive synthetic trades or volume.

The production interface keeps this transport detail quiet: it shows concise
market and transaction states instead of repeating live, verified, confirmed,
or devnet badges throughout the terminal. Chain commitment and provider details
remain here in the technical documentation.

The `Official` chart source is available on every cluster, including devnet and
pre-graduation DBC curves. Mainnet markets also expose GMGN's documented embed
at `https://www.gmgn.cc/kline/sol/{mint}` as an independent indexed view. GMGN
is intentionally disabled on devnet because it does not index test tokens.

The default devnet RPC works without additional configuration. For lower latency
and better production reliability, configure both server-only variables with a
Helius or another Solana WebSocket provider:

```bash
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WSS_URL=wss://devnet.helius-rpc.com/?api-key=YOUR_KEY
```

Do not expose the provider key through `NEXT_PUBLIC_*`. Helius standard
WebSockets work with this implementation immediately; its richer
`transactionSubscribe` or LaserStream gRPC products are an upgrade path when
CMX needs to index many pools or persist a market-wide trade archive.

## DBC boundary and DAMM v2 migration

The final buy is quoted and submitted with Meteora `swapQuote2` / `swap2` in
`PartialFill` mode. If the order crosses the end of the curve, the receipt shows
the cmB200 actually spent and the unspent amount left in the wallet.

Migration readiness comes from the DBC account itself:
`quoteReserve >= migrationQuoteThreshold`. The rounded progress percentage is
display-only and never authorizes migration. When the exact threshold is met,
the market disables curve trading and exposes a permissionless DAMM v2 migration
action as a fallback to Meteora's migrator service.

The finish-review market completed this path on devnet and migrated to DAMM v2
pool [`F2ZVSu4jNv3NTY6DDx4UAjA611DnbdtbGVWA76Zt27QE`](https://explorer.solana.com/address/F2ZVSu4jNv3NTY6DDx4UAjA611DnbdtbGVWA76Zt27QE?cluster=devnet).

Run the end-to-end stream smoke test while the local app is running:

```bash
npm run test:live
```

## Program test

Build and start a validator from WSL/Linux:

```bash
anchor build
solana-test-validator --reset \
  --ledger /tmp/cmx-test-ledger \
  --bpf-program BhgV3HcxzK9aUnhcfyez96ctBhESzvZXuE6A3x8LhuLG \
  target/deploy/gpu_market.so
```

In another WSL/Linux shell with Node installed:

```bash
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET=.keys/testnet-deployer.json \
node tests/gpu-market.mjs
```

Or run the test client from Windows PowerShell while the WSL validator is live:

```powershell
$env:ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899"
$env:ANCHOR_WALLET = (Resolve-Path .keys/testnet-deployer.json)
node tests/gpu-market.mjs
```

The smoke test covers initialization, faucet, index buy/sell, market launch,
curve buy/sell, and fee-ledger accrual.

## Devnet deployment

The checked-in program ID is
`BhgV3HcxzK9aUnhcfyez96ctBhESzvZXuE6A3x8LhuLG`. The current deployer public
key is `DuxpFkiZjfewgx1ue6qtWwvf9ibrK3UqvThRsPXT1zjC`; fund it with at least
2.37 devnet SOL before deploying the current 464 KB binary.

```bash
solana balance --url devnet --keypair .keys/testnet-deployer.json
solana program deploy target/deploy/gpu_market.so \
  --program-id target/deploy/gpu_market-keypair.json \
  --keypair .keys/testnet-deployer.json \
  --url devnet
npm run setup:devnet
npm run keeper:devnet
```

`setup:devnet` creates `deployment/devnet.json`,
which the web app serves to the wallet client. Redeploy the web app after that
file exists. Never commit
`.keys/`.

The checked-in manifest includes Meteora DBC config
`3zuTPcfBc6mLZRBeP9hdQYt5bPzb8kLvGiyxDRpBRZuv` and probe market
`EmRzxH22dNtSJD3sDGER9Ayom9F6EXCgWEucQzg5d4WY`. That probe has finalized
launch, metadata, sell, and subsequent swap transactions on devnet, so the
market directory and history pipeline operate on real chain activity rather
than fixtures.

`keeper:devnet` is a single refresh pass: it fetches the latest composite
prices, submits one on-chain update per registered index, refreshes
`deployment/devnet.json`, and exits. Schedule it once per day with Windows Task
Scheduler, cron, or a Railway worker if you want prices to keep updating
automatically. Each feed is valid for three days; after that, stale-price
trades are rejected until the keeper runs again.

## Cost and liquidity model

- Current program binary rent on devnet: about 2.36 SOL (recoverable if the
  program account is closed by its authority).
- Config, feeds, mints, and vaults require a small additional amount of SOL.
- No protocol-funded quote liquidity is required to open an index. Redemption
  capacity grows from prior buys, so sell capacity is explicitly bounded by each
  vault's test-USDC balance.
- Real mainnet peg depth is therefore a product choice: seed USDC if immediate
  redemptions are required, or retain the one-sided bootstrap behavior for the
  lowest-cost launch.

## Production

The application includes `railway.json` and a multi-stage `Dockerfile`:

```bash
railway up --service cmx-compute-market
```
