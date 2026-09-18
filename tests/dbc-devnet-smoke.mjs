import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  DynamicBondingCurveClient,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  deriveDbcPoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { loadDeployer } from "../scripts/keypair.mjs";

const deploymentPath = "deployment/devnet.json";
const deployment = JSON.parse(await readFile(deploymentPath, "utf8"));
const idl = JSON.parse(await readFile("target/idl/gpu_market.json", "utf8"));
const payer = await loadDeployer(".keys/testnet-deployer.json");
const connection = new Connection(process.env.SOLANA_RPC_URL ?? deployment.rpcUrl, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const program = new anchor.Program(idl, provider);
const user = payer.publicKey;
const b200 = deployment.indices.find((index) => index.symbol === "B200");

assert(b200, "B200 deployment entry is required");
assert(deployment.dbc?.config, "Meteora DBC config is required");
assert.equal(deployment.dbc.programId, DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58());

const config = new PublicKey(deployment.config);
const quoteMint = new PublicKey(deployment.quoteMint);
const b200Mint = new PublicKey(b200.mint);
const b200Feed = new PublicKey(b200.feed);
const userQuote = getAssociatedTokenAddressSync(quoteMint, user);
const userB200 = getAssociatedTokenAddressSync(b200Mint, user);
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

const currentB200 = await connection.getAccountInfo(userB200)
  ? Number((await getAccount(connection, userB200)).amount) / 1_000_000
  : 0;

if (currentB200 < 5) {
  const quoteIn = 500 * 1_000_000;
  const minimumB200Out = Math.floor((500 * 0.997 * 0.99 * 1_000_000) / b200.price);
  signatures.b200Seed = await program.methods
    .buyIndex(new BN(quoteIn), new BN(minimumB200Out))
    .accounts({
      config,
      feed: b200Feed,
      quoteMint,
      indexMint: b200Mint,
      userQuote,
      userIndex: userB200,
      quoteVault: new PublicKey(b200.quoteVault),
      user,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

const dbc = new DynamicBondingCurveClient(connection, "confirmed");
const dbcConfig = new PublicKey(deployment.dbc.config);
const configState = await dbc.state.getPoolConfig(dbcConfig);
assert(configState, "DBC config must exist on devnet");
assert(configState.quoteMint.equals(b200Mint), "DBC quote mint must be cmB200");

const baseMint = Keypair.generate();
const pool = deriveDbcPoolAddress(b200Mint, baseMint.publicKey, dbcConfig);
const launch = await dbc.creator.createPoolWithFirstBuy({
  createPoolParam: {
    name: "CMX B200 Devnet Probe",
    symbol: "B2PROBE",
    uri: "https://compute.market/api/token-metadata?name=CMX%20B200%20Devnet%20Probe&symbol=B2PROBE",
    payer: user,
    poolCreator: user,
    config: dbcConfig,
    baseMint: baseMint.publicKey,
  },
  firstBuyParam: {
    buyer: user,
    buyAmount: new BN(1_000_000),
    minimumAmountOut: new BN(1),
    referralTokenAccount: null,
  },
});
signatures.launch = await sendAndConfirmTransaction(connection, launch, [payer, baseMint], {
  commitment: "confirmed",
});

const metadata = await dbc.creator.createPoolMetadata({
  virtualPool: pool,
  name: "CMX B200 Devnet Probe",
  website: "https://compute.market",
  logo: "https://compute.market/assets/b200-nvl8-v2-web.png",
  creator: user,
  payer: user,
});
signatures.metadata = await sendAndConfirmTransaction(connection, metadata, [payer], {
  commitment: "confirmed",
});

const decodedPool = await dbc.state.getPool(pool);
assert(decodedPool, "DBC pool must exist after launch");
// SDK 1.5.12 returns the standard SPL account under `poolState`, while its
// public type still describes the unwrapped account.
const poolState = decodedPool.poolState ?? decodedPool;
assert(poolState.config.equals(dbcConfig), "pool must use the CMX DBC config");
assert(poolState.creator.equals(user), "pool creator must be the connected signer");

const baseAta = getAssociatedTokenAddressSync(baseMint.publicKey, user);
const baseBalance = await getAccount(connection, baseAta);
assert(baseBalance.amount > 0n, "first buy must deliver launch tokens");

const sellAmount = baseBalance.amount / 10n;
const sell = await dbc.pool.swap({
  owner: user,
  pool,
  amountIn: new BN(sellAmount.toString()),
  minimumAmountOut: new BN(1),
  swapBaseForQuote: true,
  referralTokenAccount: null,
});
signatures.sell = await sendAndConfirmTransaction(connection, sell, [payer], {
  commitment: "confirmed",
});

const feeMetrics = await dbc.state.getPoolFeeMetrics(pool);
assert(
  feeMetrics.total.totalTradingQuoteFee.gt(new BN(0)),
  "DBC trading fee ledger must accrue quote-token fees",
);

deployment.dbc.probePool = pool.toBase58();
deployment.dbc.probeBaseMint = baseMint.publicKey.toBase58();
deployment.dbc.probeSignatures = signatures;
await writeFile(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);

console.log(JSON.stringify({
  status: "passed",
  config: dbcConfig.toBase58(),
  pool: pool.toBase58(),
  baseMint: baseMint.publicKey.toBase58(),
  assertions: ["cmB200 reserve", "DBC config", "DBC launch", "first buy", "sell", "fee accrual"],
  signatures,
}, null, 2));
