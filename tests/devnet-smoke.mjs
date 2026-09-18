import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { loadDeployer } from "../scripts/keypair.mjs";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const deployment = JSON.parse(await readFile("deployment/devnet.json", "utf8"));
const idl = JSON.parse(await readFile("target/idl/gpu_market.json", "utf8"));
const payer = await loadDeployer(".keys/testnet-deployer.json");
const connection = new Connection(rpcUrl, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const user = payer.publicKey;

assert.equal(program.programId.toBase58(), deployment.programId, "IDL and deployment program IDs must match");
assert((await connection.getAccountInfo(program.programId))?.executable, "program must be executable on devnet");

const config = new PublicKey(deployment.config);
const quoteMint = new PublicKey(deployment.quoteMint);
const configState = await program.account.config.fetch(config);
assert(configState.authority.equals(user), "deployer must control the config");
assert(configState.quoteMint.equals(quoteMint), "manifest quote mint must match the config");

const index = deployment.indices.find((item) => item.symbol === "H100");
assert(index, "H100 deployment entry is required");
const feed = new PublicKey(index.feed);
const indexMint = new PublicKey(index.mint);
const quoteVault = new PublicKey(index.quoteVault);
const userQuote = getAssociatedTokenAddressSync(quoteMint, user);
const userIndex = getAssociatedTokenAddressSync(indexMint, user);
const [receipt] = PublicKey.findProgramAddressSync(
  [Buffer.from("faucet"), user.toBuffer()],
  program.programId,
);

const signatures = {};
if (!(await connection.getAccountInfo(receipt))) {
  signatures.faucet = await program.methods
    .claimTestUsdc()
    .accounts({
      config,
      quoteMint,
      userQuote,
      receipt,
      user,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

const quoteBefore = await getAccount(connection, userQuote);
const indexBefore = await connection.getAccountInfo(userIndex)
  ? await getAccount(connection, userIndex)
  : { amount: 0n };
const quoteIn = 100_000_000;
const minimumIndexOut = Math.floor((100 * 0.997 * 0.99 * 1_000_000) / index.price);
signatures.indexBuy = await program.methods
  .buyIndex(new BN(quoteIn), new BN(minimumIndexOut))
  .accounts({
    config,
    feed,
    quoteMint,
    indexMint,
    userQuote,
    userIndex,
    quoteVault,
    user,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const indexAfterBuy = await getAccount(connection, userIndex);
const bought = indexAfterBuy.amount - indexBefore.amount;
assert(bought >= BigInt(minimumIndexOut), "index buy must deliver the quoted minimum");

const sellAmount = bought / 2n;
const minimumQuoteOut = (sellAmount * BigInt(Math.round(index.price * 1_000_000)) * 987n) / 1_000_000n / 1000n;
signatures.indexSell = await program.methods
  .sellIndex(new BN(sellAmount.toString()), new BN(minimumQuoteOut.toString()))
  .accounts({
    config,
    feed,
    quoteMint,
    indexMint,
    userQuote,
    userIndex,
    quoteVault,
    user,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();

const quoteAfter = await getAccount(connection, userQuote);
assert(quoteAfter.amount > quoteBefore.amount - BigInt(quoteIn), "index redemption must return quote liquidity");

const nonce = new BN(Date.now());
const nonceBytes = nonce.toArrayLike(Buffer, "le", 8);
const [market] = PublicKey.findProgramAddressSync(
  [Buffer.from("market"), user.toBuffer(), nonceBytes],
  program.programId,
);
const [marketMint] = PublicKey.findProgramAddressSync(
  [Buffer.from("market-mint"), market.toBuffer()],
  program.programId,
);
const [tokenVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("market-token-vault"), market.toBuffer()],
  program.programId,
);
const [pairVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("market-pair-vault"), market.toBuffer()],
  program.programId,
);
const fixedBytes = (value, size) => {
  const output = Buffer.alloc(size);
  output.write(value, "utf8");
  return [...output];
};

signatures.marketCreate = await program.methods
  .createMarket(
    nonce,
    fixedBytes("CMX Devnet Probe", 32),
    16,
    fixedBytes("PROBE", 8),
    5,
    100,
  )
  .accounts({
    config,
    feed,
    pairMint: indexMint,
    market,
    marketMint,
    tokenVault,
    pairVault,
    creator: user,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const userMarket = getAssociatedTokenAddressSync(marketMint, user);
signatures.marketBuy = await program.methods
  .buyMarket(new BN(1_000_000), new BN(1))
  .accounts({
    market,
    pairFeed: feed,
    pairMint: indexMint,
    marketMint,
    tokenVault,
    pairVault,
    userPair: userIndex,
    userMarket,
    user,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const marketTokens = await getAccount(connection, userMarket);
assert(marketTokens.amount > 1n, "bonding curve buy must deliver market tokens");
signatures.marketSell = await program.methods
  .sellMarket(new BN((marketTokens.amount / 2n).toString()), new BN(1))
  .accounts({
    market,
    pairFeed: feed,
    pairMint: indexMint,
    marketMint,
    tokenVault,
    pairVault,
    userPair: userIndex,
    userMarket,
    user,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const marketState = await program.account.market.fetch(market);
assert(marketState.holderFees.gt(new BN(0)), "holder fee ledger must accrue");
assert(marketState.buybackFees.gt(new BN(0)), "buyback fee ledger must accrue");
assert(marketState.protocolFees.gt(new BN(0)), "protocol fee ledger must accrue");

console.log(JSON.stringify({
  status: "passed",
  programId: program.programId.toBase58(),
  market: market.toBase58(),
  assertions: ["executable", "config", "faucet", "index buy/sell", "curve buy/sell", "40/30/30 fee ledgers"],
  signatures,
}, null, 2));
