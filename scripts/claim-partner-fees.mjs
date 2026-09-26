import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const ROOT = process.cwd();
const cluster = process.env.SOLANA_CLUSTER;
const poolAddress = process.argv.slice(2).find((arg) => arg !== "--mainnet");
if (cluster !== "mainnet-beta" || !process.argv.includes("--mainnet")) {
  throw new Error("Set SOLANA_CLUSTER=mainnet-beta and pass --mainnet.");
}
if (!poolAddress) throw new Error("Pass the DBC pool address to claim its CMX partner fees.");
const rpcUrl = process.env.SOLANA_MAINNET_RPC_URL ?? process.env.SOLANA_RPC_URL;
if (!rpcUrl || rpcUrl.includes("api.mainnet-beta.solana.com")) {
  throw new Error("Set a private SOLANA_MAINNET_RPC_URL.");
}
const deployment = JSON.parse(await readFile(path.join(ROOT, "deployment", "mainnet-beta.json"), "utf8"));
const signer = await loadDeployer(path.join(ROOT, ".keys", "mainnet-deployer.json"));
if (deployment.feeRecipient !== signer.publicKey.toBase58()) {
  throw new Error("The signer does not match the mainnet fee recipient.");
}
const connection = new Connection(rpcUrl, "confirmed");
if (await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
  throw new Error("RPC genesis hash is not Solana mainnet.");
}
const dbc = new DynamicBondingCurveClient(connection, "confirmed");
const pool = new PublicKey(poolAddress);
const state = await dbc.state.getPool(pool);
if (!state) throw new Error("DBC pool does not exist.");
const allowed = [deployment.dbc.config, ...(deployment.dbc.previousConfigs ?? []).map((entry) => entry.config)];
if (!allowed.includes(state.poolState.config.toBase58())) throw new Error("Pool is outside CMX DBC configurations.");
const config = await dbc.state.getPoolConfig(state.poolState.config);
if (!config?.feeClaimer.equals(signer.publicKey) || !config.quoteMint.equals(new PublicKey(deployment.dbc.quoteMint))) {
  throw new Error("DBC config does not route CMX fees to this wallet.");
}
const maxAmount = new BN("18446744073709551615");
const transaction = await dbc.partner.claimPartnerTradingFee({
  feeClaimer: signer.publicKey,
  payer: signer.publicKey,
  pool,
  maxBaseAmount: maxAmount,
  maxQuoteAmount: maxAmount,
});
const signature = await sendAndConfirmTransaction(connection, transaction, [signer], { commitment: "confirmed" });
console.log(JSON.stringify({ pool: pool.toBase58(), recipient: signer.publicKey.toBase58(), signature }));
