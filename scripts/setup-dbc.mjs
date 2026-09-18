import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DammV2DynamicFeeMode,
  DynamicBondingCurveClient,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurveWithMarketCap,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const ROOT = process.cwd();
const CLUSTER = process.env.SOLANA_CLUSTER ?? "devnet";
const DEPLOYMENT_PATH = path.join(ROOT, "deployment", `${CLUSTER}.json`);
const KEYPAIR_PATH = process.env.DEPLOYER_KEYPAIR ?? path.join(ROOT, ".keys", "testnet-deployer.json");

if (CLUSTER !== "devnet") {
  throw new Error("CMX DBC setup is intentionally restricted to devnet for now.");
}

const deployment = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8"));
const payer = await loadDeployer(KEYPAIR_PATH);
const connection = new Connection(process.env.SOLANA_RPC_URL ?? deployment.rpcUrl, "confirmed");
const b200 = deployment.indices.find((index) => index.symbol === "B200");

if (!b200) throw new Error("The B200 index must be deployed before creating the DBC config.");

if (deployment.dbc?.config) {
  const existing = new PublicKey(deployment.dbc.config);
  if (await connection.getAccountInfo(existing)) {
    console.log(`Using existing Meteora DBC config ${existing.toBase58()}`);
    process.exit(0);
  }
}

const curve = buildCurveWithMarketCap({
  token: {
    tokenType: TokenType.SPLToken,
    tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: TokenDecimal.SIX,
    tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: 1_000_000_000,
    leftover: 0,
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: 200,
        endingFeeBps: 200,
        numberOfPeriod: 0,
        totalDuration: 0,
      },
    },
    dynamicFeeEnabled: false,
    collectFeeMode: CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: 50,
    poolCreationFee: 0,
    enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.FixedBps100,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    migratedPoolFee: {
      collectFeeMode: MigratedCollectFeeMode.QuoteToken,
      dynamicFee: DammV2DynamicFeeMode.Disabled,
      poolFeeBps: 25,
    },
  },
  liquidityDistribution: {
    partnerPermanentLockedLiquidityPercentage: 50,
    partnerLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 50,
    creatorLiquidityPercentage: 0,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0,
    numberOfVestingPeriod: 0,
    cliffUnlockAmount: 0,
    totalVestingDuration: 0,
    cliffDurationFromMigrationTime: 0,
  },
  activationType: ActivationType.Slot,
  initialMarketCap: 100,
  migrationMarketCap: 1_000,
});

const config = Keypair.generate();
const client = new DynamicBondingCurveClient(connection, "confirmed");
const transaction = await client.partner.createConfig({
  ...curve,
  config: config.publicKey,
  feeClaimer: payer.publicKey,
  leftoverReceiver: payer.publicKey,
  quoteMint: new PublicKey(b200.mint),
  payer: payer.publicKey,
});
const signature = await sendAndConfirmTransaction(connection, transaction, [payer, config], {
  commitment: "confirmed",
});

deployment.dbc = {
  programId: DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(),
  config: config.publicKey.toBase58(),
  quoteSymbol: "B200",
  quoteMint: b200.mint,
  tradingFeeBps: 200,
  migrationFeeOption: Number(curve.migrationFeeOption),
  migrationQuoteThreshold: curve.migrationQuoteThreshold.toString(),
  creatorTradingFeePercentage: 50,
  initialMarketCapInQuote: 100,
  migrationMarketCapInQuote: 1_000,
  migration: "DAMM v2",
  migratedLiquidity: "50% creator locked / 50% CMX locked",
  signature,
};

await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify({ config: deployment.dbc.config, signature }, null, 2));
