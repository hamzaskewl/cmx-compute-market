import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { createMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const ROOT = process.cwd();
const CLUSTER = process.env.SOLANA_CLUSTER ?? "devnet";
const RPC_URL = process.env.SOLANA_RPC_URL ?? `https://api.${CLUSTER}.solana.com`;
const IDL_PATH = path.join(ROOT, "target", "idl", "gpu_market.json");
const KEYPAIR_PATH = process.env.DEPLOYER_KEYPAIR ?? path.join(ROOT, ".keys", "testnet-deployer.json");
const DEPLOYMENT_PATH = path.join(ROOT, "deployment", `${CLUSTER}.json`);
const MAX_AGE_SECONDS = 3 * 24 * 60 * 60;

const symbolBytes = (symbol) => {
  const bytes = Buffer.alloc(12);
  bytes.write(symbol, "utf8");
  return bytes;
};

const ornnSymbol = {
  "H100 SXM": "H100",
  H200: "H200",
  B200: "B200",
  "A100 SXM4": "A100",
  "RTX 5090": "5090",
};

const idl = JSON.parse(await readFile(IDL_PATH, "utf8"));
const payer = await loadDeployer(KEYPAIR_PATH);
const connection = new Connection(RPC_URL, "confirmed");
const wallet = new anchor.Wallet(payer);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

let quoteMint;
const configInfo = await connection.getAccountInfo(config);
if (!configInfo) {
  quoteMint = await createMint(connection, payer, config, null, 6);
  await program.methods
    .initialize()
    .accounts({ config, quoteMint, authority: payer.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  console.log(`Initialized config ${config.toBase58()}`);
} else {
  const configAccount = await program.account.config.fetch(config);
  quoteMint = configAccount.quoteMint;
  console.log(`Using existing config ${config.toBase58()}`);
}

const response = await fetch("https://api.ornnai.com/api/daily-index/all");
if (!response.ok) throw new Error(`Ornn returned ${response.status}`);
const payload = await response.json();
const indices = [];

for (const row of payload.data ?? []) {
  const symbol = ornnSymbol[row.gpu_type];
  if (!symbol) continue;
  const padded = symbolBytes(symbol);
  const price = Math.round(Number(row.index_value) * 1_000_000);
  const [feed] = PublicKey.findProgramAddressSync([Buffer.from("feed"), padded], program.programId);
  const [indexMint] = PublicKey.findProgramAddressSync([Buffer.from("index-mint"), padded], program.programId);
  const [quoteVault] = PublicKey.findProgramAddressSync([Buffer.from("quote-vault"), padded], program.programId);

  if (!(await connection.getAccountInfo(feed))) {
    await program.methods
      .registerIndex([...padded], Buffer.byteLength(symbol), new BN(price), new BN(MAX_AGE_SECONDS))
      .accounts({
        config,
        feed,
        indexMint,
        quoteVault,
        quoteMint,
        authority: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`Registered ${symbol} at $${row.index_value}`);
  } else {
    await program.methods
      .updatePrice(new BN(price))
      .accounts({ config, feed, oracleAuthority: payer.publicKey })
      .rpc();
    console.log(`Updated ${symbol} to $${row.index_value}`);
  }

  indices.push({
    symbol,
    name: row.gpu_type,
    price: Number(row.index_value),
    feed: feed.toBase58(),
    mint: indexMint.toBase58(),
    quoteVault: quoteVault.toBase58(),
  });
}

const deployment = {
  cluster: CLUSTER,
  rpcUrl: RPC_URL,
  programId: program.programId.toBase58(),
  config: config.toBase58(),
  quoteMint: quoteMint.toBase58(),
  oracleUpdatedAt: payload.date,
  indices,
};

await mkdir(path.dirname(DEPLOYMENT_PATH), { recursive: true });
await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(`Saved ${path.relative(ROOT, DEPLOYMENT_PATH)}`);
