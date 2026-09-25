# Mainnet launch runbook

The public Mainnet manifest does not exist until the program and DBC config are
deployed. The current Railway website and migrator remain on Devnet during
preparation.

## Addresses and custody

| Role | Address |
| --- | --- |
| Deployer, CMX fee recipient, oracle and initial program authority, migration payer | `7tLwmGdZpz2ar337WDp33P5Gm4JxbnRuh6CZejv5HTAU` |
| New CMX program ID | `7M2BCLQXQpoGu4V8tcfZ4Hheu95kJfwYHyTVhUGhPPA5` |
| Circle native Solana USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

The deployer and program keypair files are in `.keys/`, which Git ignores. Back
them up securely. The deployer secret was pasted into chat and must be treated
as exposed. Rotate it before accepting significant public funds. The new CMX
program has `set_authorities` for its admin, oracle, and fee recipient, but the
Solana program upgrade authority and Meteora DBC fee claimer must be rotated
separately if the signer changes.

The app charges 0.30% to mint or redeem an index. On this new program, that fee
is sent in USDC to the configured fee recipient's token account. The Meteora
DBC config names the same wallet as partner fee claimer and leftover receiver.
Token creators retain their advertised 50% creator share. Meteora's protocol
share and Solana transaction fees do not belong to CMX. DBC partner fees
accumulate until claimed with `npm run claim:partner-fees -- POOL --mainnet`;
DAMM v2 position fees likewise require a position claim operation after
migration.

## Preflight and build

Use a private Solana mainnet HTTP/WebSocket provider. The existing Railway web
service has Helius mainnet endpoints configured. Do not put provider URLs in
the public deployment manifest or in `NEXT_PUBLIC_*` variables.

```powershell
$env:SOLANA_CLUSTER = "mainnet-beta"
$env:SOLANA_MAINNET_RPC_URL = "<private mainnet HTTP RPC>"
$env:SOLANA_MAINNET_WSS_URL = "<matching private WebSocket RPC>"
npm run preflight:mainnet
npm run prepare:mainnet-build
anchor build
npm run sync:mainnet-idl
npm run preflight:mainnet
```

Use Anchor 0.32.1 and Solana 4.2.2, as recorded in `Anchor.toml`. The built IDL
and `.so` must be verified against the source and the generated mainnet program
ID. Run the local validator test (`anchor test`) and a full independent review
of oracle, reserve, redemption, fee, and upgrade controls before deploying.

The compiled Mainnet program is 410,520 bytes. Solana Mainnet currently
requires 2.087154 SOL held in the program accounts and another 2.086280 SOL
temporarily for the upload buffer. The deployment peak is about 4.173433 SOL,
plus about 0.028 SOL of initial config, feed, mint, vault, and DBC account rent,
and transaction fees. Fund the deployer to at least 6 SOL total, with a larger
operating buffer for future migrations. Re-run the preflight before deployment
because network rent and wallet balance can change.

## Deploy and initialize

After funding and verification, deploy the exact built binary using the saved
program ID keypair. Do not use `anchor deploy` without checking its generated
program address.

```powershell
solana program deploy target/deploy/gpu_market.so --program-id .keys/mainnet-program.json --keypair .keys/mainnet-deployer.json --url $env:SOLANA_MAINNET_RPC_URL
npm run setup:mainnet
npm run setup:dbc -- --mainnet --preview
npm run setup:dbc -- --mainnet
```

`setup:mainnet` verifies the mainnet genesis hash, executable program, official
USDC mint, authorities, and recent public Ornn prices. It registers GPU feeds
and writes `.keys/mainnet-pending.json`; this file is not served to the site.
`setup:dbc` sets the partner fee claimer and leftover receiver to the same
wallet and only then writes `deployment/mainnet-beta.json`. Check the onchain
config, quote mint, fee claimer, curve, and migration settings before changing
the Railway website's default cluster.

## Operate

Run the oracle keeper daily with the mainnet private RPC and the authorized
signer. It refuses Ornn daily data more than 36 hours old. The onchain feed
expires after 36 hours without a valid update. Set up a separate persistent
Mainnet migrator service with one replica, a private matching RPC and
WebSocket, and these secrets:

| Variable | Value |
| --- | --- |
| `SOLANA_CLUSTER` | `mainnet-beta` |
| `MIGRATOR_ENABLED` | `true` after dry run and checks |
| `MIGRATOR_ENABLE_MAINNET` | `true` |
| `MIGRATOR_EXPECTED_GENESIS_HASH` | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |
| `MIGRATOR_KEYPAIR_JSON` | 64-byte secret array in a Railway secret variable; never in Git or logs |

The worker refuses to sign if its wallet differs from the manifest fee
recipient. Keep sufficient SOL for account rent and priority fees. Verify a
small mainnet USDC mint/redeem, DBC buy/sell, graduation, DAMM v2 trade, and
both partner fee claims before routing users to Mainnet.

cmB200 is a USDC-backed price exposure to the Ornn B200 index, not a guaranteed
USDC redemption. A price increase can make the reserve insufficient to redeem
all circulating cmB200 at the latest reference price. The program rejects
redemptions that exceed available USDC, but it cannot replenish the reserve.
Publish and review a reserve funding and loss policy before public launch.
