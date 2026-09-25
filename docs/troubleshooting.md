# Devnet operations and troubleshooting

Start with the selected network, the transaction signature (if one exists), and the time of the failure. Keep provider URLs, API keys, and signer secrets out of screenshots and issue reports.

| Symptom | First check | Next action |
| --- | --- | --- |
| Railway returns `404 Application not found` | Check that the public domain still points to the running web service and that its latest deployment is healthy. | Restore the service/domain mapping or roll back the failed deployment. This response is from Railway's edge, before the app can answer. |
| `/api/rpc` returns 502 or calls time out | Check the server's cluster-specific RPC variable and provider health. The proxy has a 20-second upstream timeout. | Use a healthy RPC endpoint for the same cluster, then reload. Do not put the provider key in a `NEXT_PUBLIC_*` variable. |
| RPC requests are slow or rate-limited | Check provider request limits and whether Devnet HTTP and WebSocket URLs match. | Reduce competing indexer/worker load or move to an endpoint with enough capacity. A Mainnet RPC URL cannot serve Devnet accounts. |
| Wallet shows `Confirming…` for a long time | Find the submitted signature in the UI error or wallet history, then inspect it on Solana Explorer with the correct cluster. | If confirmed, refresh balances and the market. If absent or failed, retry only after checking the status; repeated clicks can create duplicate transactions. |
| Preflight reports `InstructionError` | Read the simulation logs and check wallet SOL, token balances, account state, and the selected cluster. | Fix the specific failed precondition. An error number alone is not enough to identify which program or instruction failed. |
| Explore or a market page loads slowly | Check `/api/markets` and `/api/markets/[address]` separately from `/api/rpc`. | The market summary can appear before confirmed swap history; investigate RPC transaction limits if volume or candles lag. |
| A graduated pool is still on the curve page | Check the DBC pool's onchain migrated state and the DAMM v2 pool address. | Allow the market index to refresh. If migration is only eligible, follow the worker checks below. |

## Migration worker

The worker is a separate service. Its one-minute `heartbeat` reports scans, WebSocket events, eligible pools, submissions, confirmations, failures, RPC errors, and in-flight attempts. A missing heartbeat means the service is not running or cannot write logs. Repeated `scan_failed` points to RPC or configuration trouble; `attempt_failed` needs the corresponding onchain transaction and funded fee-payer balance checked. `submitted` means the transaction was sent, while `confirmed` means the worker reread the pool as migrated. See [automatic migration](auto-migration.md) for variables and startup checks.

The backup scan on the deployed worker runs every 15 seconds to conserve RPC capacity. WebSocket account updates are the fast path. A three-second end-to-end graduation is a target for detection and submission under healthy conditions, not a confirmation guarantee.

## Before retrying a transaction

1. Confirm that the wallet and app show the same network.
2. Check the signature on Solana Explorer for that network. If the transaction landed, refresh the page and balances.
3. If it failed, inspect the program logs or simulation error and correct the cause before resubmitting.
4. If there is no signature, check the wallet's pending approval and the browser/network connection.

Never paste a wallet secret, RPC API key, or full provider URL into an issue or chat log.
