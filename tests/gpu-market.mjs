import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const idl = JSON.parse(await readFile("target/idl/gpu_market.json", "utf8"));
const program = new anchor.Program(idl, provider);
const payer = provider.wallet.payer;
const user = provider.wallet.publicKey;
if ((await provider.connection.getBalance(user)) < 5_000_000_000) {
  const airdrop = await provider.connection.requestAirdrop(user, 10_000_000_000);
  await provider.connection.confirmTransaction(airdrop, "confirmed");
}
const bytes = (text, size) => {
  const value = Buffer.alloc(size);
  value.write(text);
  return value;
};

const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const quoteMint = await createMint(provider.connection, payer, config, null, 6);

await program.methods
  .initialize()
  .accounts({ config, quoteMint, authority: user, systemProgram: SystemProgram.programId })
  .rpc();

const symbol = bytes("H100", 12);
const [feed] = PublicKey.findProgramAddressSync([Buffer.from("feed"), symbol], program.programId);
const [indexMint] = PublicKey.findProgramAddressSync([Buffer.from("index-mint"), symbol], program.programId);
const [quoteVault] = PublicKey.findProgramAddressSync([Buffer.from("quote-vault"), symbol], program.programId);

await program.methods
  .registerIndex([...symbol], 4, new BN(2_866_667), new BN(86_400))
  .accounts({
    config,
    feed,
    indexMint,
    quoteVault,
    quoteMint,
    authority: user,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const userQuote = getAssociatedTokenAddressSync(quoteMint, user);
const userIndex = getAssociatedTokenAddressSync(indexMint, user);
const [receipt] = PublicKey.findProgramAddressSync([Buffer.from("faucet"), user.toBuffer()], program.programId);

await program.methods
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

await program.methods
  .buyIndex(new BN(100_000_000), new BN(34_000_000))
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

const bought = await getAccount(provider.connection, userIndex);
assert(bought.amount > 34_000_000n, "oracle buy should mint H100 index coins");

await program.methods
  .sellIndex(new BN(17_000_000), new BN(48_000_000))
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

const quoteAfterRoundTrip = await getAccount(provider.connection, userQuote);
assert(quoteAfterRoundTrip.amount > 9_948_000_000n, "redemption should use accumulated bid liquidity");

const nonce = new BN(1);
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

await program.methods
  .createMarket(nonce, [...bytes("Tensor Club", 32)], 11, [...bytes("TNSR", 8)], 4, 100)
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
await program.methods
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

const launched = await getAccount(provider.connection, userMarket);
assert(launched.amount > 0n, "bonding curve should deliver launched tokens");

await program.methods
  .sellMarket(new BN((launched.amount / 2n).toString()), new BN(1))
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
assert(marketState.holderFees.gt(new BN(0)), "40/30/30 fee ledgers should accrue");
console.log("Local smoke test passed: faucet, index buy/sell, market launch, and curve buy/sell.");
