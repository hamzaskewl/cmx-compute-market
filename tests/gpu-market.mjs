import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

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
const [programData] = PublicKey.findProgramAddressSync(
  [program.programId.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
);
const quoteMint = await createMint(provider.connection, payer, user, null, 6);
const feeRecipient = Keypair.generate().publicKey;
const feeAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, quoteMint, feeRecipient);
const userQuote = (await getOrCreateAssociatedTokenAccount(provider.connection, payer, quoteMint, user)).address;

await program.methods
  .initialize(feeRecipient)
  .accounts({ config, quoteMint, program: program.programId, programData,
    authority: user, systemProgram: SystemProgram.programId })
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

const userIndex = getAssociatedTokenAddressSync(indexMint, user);
await mintTo(provider.connection, payer, quoteMint, userQuote, payer, 10_000_000_000);

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
    feeAccount: feeAccount.address,
  })
  .rpc();

const bought = await getAccount(provider.connection, userIndex);
assert(bought.amount > 34_000_000n, "oracle buy should mint H100 index coins");
assert.equal((await getAccount(provider.connection, feeAccount.address)).amount, 300_000n,
  "the mint fee should reach the configured recipient");

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
    feeAccount: feeAccount.address,
  })
  .rpc();

const quoteAfterRoundTrip = await getAccount(provider.connection, userQuote);
assert(quoteAfterRoundTrip.amount > 9_948_000_000n, "redemption should use accumulated bid liquidity");
assert((await getAccount(provider.connection, feeAccount.address)).amount > 300_000n,
  "the redemption fee should reach the configured recipient");

const nextAuthority = Keypair.generate().publicKey;
await program.methods.setAuthorities(nextAuthority, user, feeRecipient)
  .accounts({ config, authority: user }).rpc();
const rotatedConfig = await program.account.config.fetch(config);
assert(rotatedConfig.authority.equals(nextAuthority), "authority rotation should update the config");
console.log("Local smoke test passed: external collateral, fee routing, index buy/sell, and authority rotation.");
