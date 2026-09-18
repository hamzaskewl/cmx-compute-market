import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const ROOT = process.cwd();
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
const deployment = JSON.parse(await readFile(path.join(ROOT, "deployment", `${cluster}.json`), "utf8"));
const idl = JSON.parse(await readFile(path.join(ROOT, "target", "idl", "gpu_market.json"), "utf8"));
const keyPath = process.env.DEPLOYER_KEYPAIR ?? path.join(ROOT, ".keys", "testnet-deployer.json");
const payer = await loadDeployer(keyPath);
const connection = new Connection(process.env.SOLANA_RPC_URL ?? deployment.rpcUrl, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const config = new PublicKey(deployment.config);

const names = new Map(deployment.indices.map((index) => [index.name, index]));
const response = await fetch("https://api.ornnai.com/api/daily-index/all");
if (!response.ok) throw new Error(`Ornn returned ${response.status}`);
const payload = await response.json();

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
