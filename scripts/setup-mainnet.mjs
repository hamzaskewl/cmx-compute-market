import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { getMint, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const ROOT = process.cwd();
const EXPECTED_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const RPC_URL = process.env.SOLANA_MAINNET_RPC_URL ?? process.env.SOLANA_RPC_URL;
const PENDING_PATH = path.join(ROOT, ".keys", "mainnet-pending.json");
const MAX_AGE_SECONDS = 36 * 60 * 60;
const NAMES = new Map([
  ["A100 SXM4", "A100"],
  ["B200", "B200"],
  ["H100 SXM", "H100"],
  ["H200", "H200"],
  ["RTX 5090", "5090"],
]);

if (process.env.SOLANA_CLUSTER !== "mainnet-beta") {
  throw new Error("Set SOLANA_CLUSTER=mainnet-beta explicitly.");
}
if (!RPC_URL || RPC_URL.includes("api.mainnet-beta.solana.com")) {
  throw new Error("Set SOLANA_MAINNET_RPC_URL to a private mainnet RPC endpoint.");
}

const idl = JSON.parse(await readFile(path.join(ROOT, "lib", "gpu_market.mainnet.json"), "utf8"));
const payer = await loadDeployer(path.join(ROOT, ".keys", "mainnet-deployer.json"));
const connection = new Connection(RPC_URL, "confirmed");
if (await connection.getGenesisHash() !== EXPECTED_GENESIS) {
  throw new Error("RPC genesis hash is not Solana mainnet.");
}
const programId = new PublicKey(idl.address);
const programInfo = await connection.getAccountInfo(programId);
if (!programInfo?.executable) {
  throw new Error(`Deploy program ${programId.toBase58()} before running mainnet setup.`);
}
const [programData] = PublicKey.findProgramAddressSync(
  [programId.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
);
const mint = await getMint(connection, USDC_MINT);
if (mint.decimals !== 6 || !mint.isInitialized) {
  throw new Error("The configured Solana USDC mint is invalid.");
}

const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
const configInfo = await connection.getAccountInfo(config);
if (!configInfo) {
  await program.methods.initialize(payer.publicKey).accounts({
    config,
    quoteMint: USDC_MINT,
    program: programId,
    programData,
    authority: payer.publicKey,
    systemProgram: SystemProgram.programId,
  }).rpc();
} else {
  const state = await program.account.config.fetch(config);
  if (!state.authority.equals(payer.publicKey)
      || !state.oracleAuthority.equals(payer.publicKey)
      || !state.feeRecipient.equals(payer.publicKey)
      || !state.quoteMint.equals(USDC_MINT)) {
    throw new Error("Onchain config does not match the expected mainnet authorities and USDC mint.");
  }
}
const feeAccount = await getOrCreateAssociatedTokenAccount(connection, payer, USDC_MINT, payer.publicKey);

const response = await fetch("https://api.ornnai.com/api/daily-index/all", { signal: AbortSignal.timeout(10_000) });
if (!response.ok) throw new Error(`Ornn public daily index returned ${response.status}.`);
const payload = await response.json();
const publishedAt = Date.parse(payload.date);
if (!Number.isFinite(publishedAt) || publishedAt > Date.now() + 5 * 60_000
    || Date.now() - publishedAt > MAX_AGE_SECONDS * 1_000) {
  throw new Error("Ornn public daily index is stale or missing its publication time.");
}
const indices = [];
for (const row of payload.data ?? []) {
  const symbol = NAMES.get(row.gpu_type);
  if (!symbol) continue;
  const price = Number(row.index_value);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid Ornn price for ${symbol}.`);
  const padded = Buffer.alloc(12);
  padded.write(symbol);
  const [feed] = PublicKey.findProgramAddressSync([Buffer.from("feed"), padded], programId);
  const [indexMint] = PublicKey.findProgramAddressSync([Buffer.from("index-mint"), padded], programId);
  const [quoteVault] = PublicKey.findProgramAddressSync([Buffer.from("quote-vault"), padded], programId);
  if (!(await connection.getAccountInfo(feed))) {
    await program.methods.registerIndex([...padded], Buffer.byteLength(symbol), new BN(Math.round(price * 1_000_000)), new BN(MAX_AGE_SECONDS))
      .accounts({ config, feed, indexMint, quoteVault, quoteMint: USDC_MINT, authority: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  } else {
    await program.methods.updatePrice(new BN(Math.round(price * 1_000_000)))
      .accounts({ config, feed, oracleAuthority: payer.publicKey }).rpc();
  }
  indices.push({ symbol, name: row.gpu_type, price, feed: feed.toBase58(),
    mint: indexMint.toBase58(), quoteVault: quoteVault.toBase58() });
}
if (!indices.some((index) => index.symbol === "B200")) throw new Error("Ornn public data omitted B200.");
const pending = {
  cluster: "mainnet-beta",
  rpcUrl: "https://api.mainnet-beta.solana.com",
  programId: programId.toBase58(),
  config: config.toBase58(),
  quoteMint: USDC_MINT.toBase58(),
  feeRecipient: payer.publicKey.toBase58(),
  feeAccount: feeAccount.address.toBase58(),
  oracleUpdatedAt: payload.date,
  indices,
};
await mkdir(path.dirname(PENDING_PATH), { recursive: true });
await writeFile(PENDING_PATH, `${JSON.stringify(pending, null, 2)}\n`);
console.log(JSON.stringify({ pending: PENDING_PATH, programId: pending.programId,
  feeRecipient: pending.feeRecipient, feeAccount: pending.feeAccount, indices: indices.map((index) => index.symbol) }));
