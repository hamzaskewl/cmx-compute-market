import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const ROOT = process.cwd();
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
const deployment = JSON.parse(await readFile(path.join(ROOT, "deployment", `${cluster}.json`), "utf8"));
const idlPath = cluster === "mainnet-beta"
  ? path.join(ROOT, "lib", "gpu_market.mainnet.json")
  : path.join(ROOT, "target", "idl", "gpu_market.json");
const idl = JSON.parse(await readFile(idlPath, "utf8"));
const keyPath = process.env.DEPLOYER_KEYPAIR ?? path.join(ROOT, ".keys", cluster === "mainnet-beta" ? "mainnet-deployer.json" : "testnet-deployer.json");
const payer = await loadDeployer(keyPath);
if (cluster === "mainnet-beta" && (deployment.programId !== idl.address || deployment.feeRecipient !== payer.publicKey.toBase58())) {
  throw new Error("Keeper program ID or oracle authority does not match the mainnet manifest.");
}
const rpcUrl = cluster === "mainnet-beta"
  ? process.env.SOLANA_MAINNET_RPC_URL ?? process.env.SOLANA_RPC_URL
  : process.env.SOLANA_RPC_URL ?? deployment.rpcUrl;
if (cluster === "mainnet-beta" && (!rpcUrl || rpcUrl.includes("api.mainnet-beta.solana.com"))) {
  throw new Error("Set a private SOLANA_MAINNET_RPC_URL for the mainnet keeper.");
}
const connection = new Connection(rpcUrl, "confirmed");
if (cluster === "mainnet-beta" && await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
  throw new Error("Keeper RPC genesis hash is not Solana mainnet.");
}
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const config = new PublicKey(deployment.config);

const names = new Map(deployment.indices.map((index) => [index.name, index]));
const response = await fetch("https://api.ornnai.com/api/daily-index/all");
if (!response.ok) throw new Error(`Ornn returned ${response.status}`);
const payload = await response.json();
if (cluster === "mainnet-beta") {
  const publishedAt = Date.parse(payload.date);
  if (!Number.isFinite(publishedAt) || publishedAt > Date.now() + 5 * 60_000
      || Date.now() - publishedAt > 36 * 60 * 60_000) {
    throw new Error("Ornn public daily index is stale or missing its publication time.");
  }
}

for (const row of payload.data ?? []) {
  const index = names.get(row.gpu_type);
  if (!index) continue;
  const signature = await program.methods
    .updatePrice(new BN(Math.round(Number(row.index_value) * 1_000_000)))
    .accounts({ config, feed: new PublicKey(index.feed), oracleAuthority: payer.publicKey })
    .rpc();
  index.price = Number(row.index_value);
  console.log(`${index.symbol}: $${row.index_value} (${signature})`);
}

deployment.oracleUpdatedAt = payload.date ?? new Date().toISOString();
await writeFile(
  path.join(ROOT, "deployment", `${cluster}.json`),
  `${JSON.stringify(deployment, null, 2)}\n`,
);
