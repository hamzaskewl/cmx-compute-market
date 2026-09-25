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
const KEYPAIR_PATH = process.env.DEPLOYER_KEYPAIR ?? path.join(ROOT, ".keys", "dbc-config-payer.json");

if (CLUSTER !== "devnet") {
  throw new Error("CMX DBC setup is intentionally restricted to devnet for now.");
}

const deployment = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8"));
const connection = new Connection(process.env.SOLANA_RPC_URL ?? deployment.rpcUrl, "confirmed");
const b200 = deployment.indices.find((index) => index.symbol === "B200");
// The immutable DBC config quotes market caps in cmB200. Calibrate to the
// requested Pump-like USD targets using the observed Ornn B200 reference.
// Recheck this reference before creating a new config; later USD values drift
// with the B200 index even when the onchain cmB200 thresholds stay fixed.
const B200_USD_AT_CALIBRATION = Number(process.env.B200_USD_REFERENCE ?? "8.06");
const INITIAL_TARGET_USD = 3_600;
const MIGRATION_TARGET_USD = 49_700;
const TOKEN_SUPPLY = 1_000_000_000;
if (!Number.isFinite(B200_USD_AT_CALIBRATION) || B200_USD_AT_CALIBRATION <= 0) {
  throw new Error("B200_USD_REFERENCE must be a positive USD price.");
}
const INITIAL_MARKET_CAP = Math.round(INITIAL_TARGET_USD / B200_USD_AT_CALIBRATION);
const MIGRATION_MARKET_CAP = Math.round(MIGRATION_TARGET_USD / B200_USD_AT_CALIBRATION);
const TRADING_FEE_BPS = 125;

if (!b200) throw new Error("The B200 index must be deployed before creating the DBC config.");

if (deployment.dbc?.config && !process.argv.includes("--new-curve") && !process.argv.includes("--preview")) {
  const existing = new PublicKey(deployment.dbc.config);
  if (await connection.getAccountInfo(existing)) {
    console.log(`Using existing Meteora DBC config ${existing.toBase58()}. Pass --new-curve to create a new immutable config.`);
    process.exit(0);
  }
}

const curve = buildCurveWithMarketCap({
  token: {
    tokenType: TokenType.SPLToken,
    tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: TokenDecimal.SIX,
    tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: TOKEN_SUPPLY,
    leftover: 0,
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: TRADING_FEE_BPS,
        endingFeeBps: TRADING_FEE_BPS,
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
  initialMarketCap: INITIAL_MARKET_CAP,
  migrationMarketCap: MIGRATION_MARKET_CAP,
});

if (process.argv.includes("--preview")) {
  console.log(JSON.stringify({
    initialMarketCapInQuote: INITIAL_MARKET_CAP,
    migrationMarketCapInQuote: MIGRATION_MARKET_CAP,
    initialMarketCapUsdAtCalibration: INITIAL_MARKET_CAP * B200_USD_AT_CALIBRATION,
    migrationMarketCapUsdAtCalibration: MIGRATION_MARKET_CAP * B200_USD_AT_CALIBRATION,
    b200UsdReference: B200_USD_AT_CALIBRATION,
    migrationQuoteThreshold: Number(curve.migrationQuoteThreshold.toString()) / 1_000_000,
    tradingFeeBps: TRADING_FEE_BPS,
    sqrtPricePoints: curve.curve.map((point) => point.sqrtPrice.toString()),
  }, null, 2));
  process.exit(0);
}

const payer = await loadDeployer(KEYPAIR_PATH);
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

const { previousConfigs: oldHistory = [], ...oldDbc } = deployment.dbc ?? {};
const previousConfigs = [
  ...oldHistory,
  ...(oldDbc.config ? [oldDbc] : []),
].filter((entry, index, entries) => entries.findIndex((other) => other.config === entry.config) === index);

deployment.dbc = {
  programId: DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(),
  config: config.publicKey.toBase58(),
  quoteSymbol: "B200",
  quoteMint: b200.mint,
  tradingFeeBps: TRADING_FEE_BPS,
  migrationFeeOption: Number(curve.migrationFeeOption),
  migrationQuoteThreshold: curve.migrationQuoteThreshold.toString(),
  creatorTradingFeePercentage: 50,
  initialMarketCapInQuote: INITIAL_MARKET_CAP,
  migrationMarketCapInQuote: MIGRATION_MARKET_CAP,
  previousConfigs,
  migration: "DAMM v2",
  migratedLiquidity: "50% creator locked / 50% CMX locked",
  probePool: oldDbc.probePool,
  probeBaseMint: oldDbc.probeBaseMint,
  probeSignatures: oldDbc.probeSignatures,
  signature,
};

await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify({ config: deployment.dbc.config, signature }, null, 2));
