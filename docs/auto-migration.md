# Automatic DBC migration

`scripts/auto-migrate.mjs` is a separate long-running worker. It watches every
DBC config in the selected deployment manifest, including `previousConfigs`,
and submits Meteora's DAMM v2 migration as soon as the pool's onchain quote
reserve reaches its configured threshold. It subscribes to confirmed account
updates and also scans every two seconds to recover missed events and restarts.
The target is to **detect and submit** in about three seconds with a healthy
private RPC/WebSocket connection. Solana confirmation and DAMM pool availability
are network-dependent and have no three-second guarantee.

The worker uses a **separate fee-payer wallet**. It does not need the program
deployer, pool creator, or any token owner's key. The migration itself remains
permissionless. One successful onchain migration makes subsequent attempts
ineligible; other workers or a user can also migrate first. Run **one worker
replica per cluster** to avoid unnecessary competing transactions.

## Local dry run

```powershell
$env:SOLANA_CLUSTER = "devnet"
$env:SOLANA_RPC_URL = "https://your-private-devnet-rpc"
$env:SOLANA_WSS_URL = "wss://your-private-devnet-rpc"
node scripts/auto-migrate.mjs
```

`MIGRATOR_ENABLED` is absent, so the worker only logs `eligible_dry_run` and
never loads a signer. Public Solana endpoints may rate-limit the two-second
scans. Use a private RPC plan with `getProgramAccounts` and WebSocket support.
The worker backs off on scan errors and keeps listening for account updates.

## Railway worker service

Use a **second persistent service**, separate from the website, with one
replica and no public domain. The root `railway.json` is an existing legacy
config for the website; it would override this worker's Dockerfile and start
command when uploading the repository root. Stage a clean upload directory
that contains the worker Dockerfile as `Dockerfile` and no `railway.json`:

```powershell
$stage = node scripts/stage-migrator.mjs
railway up $stage --path-as-root --project YOUR_PROJECT_ID --environment YOUR_ENVIRONMENT_ID --service YOUR_WORKER_SERVICE_ID
```

`stage-migrator.mjs` copies only the package files, worker scripts, and current
deployment manifests into a temporary directory. It copies no private keys.
Set the worker service to use Dockerfile builds and its Dockerfile `CMD` as the
start command. Inspect the effective settings and keep the worker in dry-run
until it logs `started` and successful scans. Railway's new service settings
should be managed in its dashboard or Infrastructure as Code; do not add a new
`railway.json` for this worker.

Worker variables:

| Variable | Value |
| --- | --- |
| `SOLANA_CLUSTER` | `devnet` or `mainnet-beta` |
| `SOLANA_RPC_URL` | Private RPC URL for that cluster |
| `SOLANA_WSS_URL` | Matching WebSocket URL |
| `SOLANA_DEVNET_RPC_URL` / `SOLANA_DEVNET_WSS_URL` | Optional Devnet overrides; take priority over the generic URLs when `SOLANA_CLUSTER=devnet` |
| `MIGRATOR_ENABLED` | `true` only when ready to sign |
| `MIGRATOR_KEYPAIR_JSON` | 64-byte Solana secret-key JSON array, stored as a Railway secret variable |
| `MIGRATOR_EXPECTED_GENESIS_HASH` | Genesis hash returned by the intended cluster RPC |
| `MIGRATOR_ENABLE_MAINNET` | `true` additionally required for mainnet signing |
| `MIGRATOR_SCAN_MS` | Optional; default `2000` |
| `MIGRATOR_PRIORITY_FEE_MICROLAMPORTS` | Optional compute-unit price; default `0` |

Railway currently uses a 15-second backup scan to conserve RPC quota. WebSocket
updates still trigger migration immediately; if the WebSocket is unavailable,
threshold detection may wait until the next scan.

Get the cluster's current genesis hash before enabling signing:

```powershell
node --input-type=module -e 'import { Connection } from "@solana/web3.js"; console.log(await new Connection("https://api.devnet.solana.com").getGenesisHash())'
```

Use the actual private RPC URL in that command when configuring the worker.
The worker refuses to sign if the configured expected hash differs from the
RPC's hash. Mainnet also requires `deployment/mainnet-beta.json` with the
matching DBC program, config, and quote mint, plus an explicit mainnet flag.
Currently the repository has only a devnet manifest.

Fund the dedicated payer with enough SOL for DAMM v2 account rent and fees,
and keep a buffer for multiple launches. A wallet with zero SOL starts the
worker but migration attempts fail. Do not paste the private key in a terminal
command, log, Git file, or client-side `NEXT_PUBLIC_*` variable. Rotate the
signer immediately if exposed. Use separate keys and services for devnet and
mainnet.

## Operations

Logs are JSON. `submitted` includes the transaction signature and elapsed
time since detection; `confirmed` means the pool's `isMigrated` state was read
after confirmation. A heartbeat every minute reports scans, WebSocket events,
eligible pools, submissions, confirmations, failures, RPC errors, and in-flight
attempts. Error messages and RPC URLs are deliberately omitted to avoid
printing API keys. Alert on repeated `scan_failed`, `attempt_failed`, or a
missing heartbeat. If a migration fails, the worker waits before retrying and
checks the onchain state again. Restarting it does not require a local database.
