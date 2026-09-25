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
const OUTPUT_PATH = path.join(ROOT, "deployment", `${CLUSTER}.json`);
const PENDING_PATH = path.join(ROOT, ".keys", "mainnet-pending.json");
const KEYPAIR_PATH = process.env.DEPLOYER_KEYPAIR ?? path.join(ROOT, ".keys", CLUSTER === "mainnet-beta" ? "mainnet-deployer.json" : "dbc-config-payer.json");

if (CLUSTER !== "devnet" && CLUSTER !== "mainnet-beta") {
  throw new Error("SOLANA_CLUSTER must be devnet or mainnet-beta.");
}
if (CLUSTER === "mainnet-beta" && !process.argv.includes("--mainnet")) {
  throw new Error("Mainnet DBC setup requires --mainnet.");
}

const source = CLUSTER === "mainnet-beta"
  ? await readFile(OUTPUT_PATH, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return readFile(PENDING_PATH, "utf8");
  })
  : await readFile(OUTPUT_PATH, "utf8");
const deployment = JSON.parse(source);
if (CLUSTER === "mainnet-beta") {
  const publishedAt = Date.parse(deployment.oracleUpdatedAt);
  if (!Number.isFinite(publishedAt) || publishedAt > Date.now() + 5 * 60_000
      || Date.now() - publishedAt > 36 * 60 * 60_000) {
    throw new Error("Refresh the Ornn reference and mainnet feeds before creating a DBC config.");
  }
}
const rpcUrl = CLUSTER === "mainnet-beta"
  ? process.env.SOLANA_MAINNET_RPC_URL ?? process.env.SOLANA_RPC_URL
  : process.env.SOLANA_RPC_URL ?? deployment.rpcUrl;
if (CLUSTER === "mainnet-beta" && (!rpcUrl || rpcUrl.includes("api.mainnet-beta.solana.com"))) {
  throw new Error("Set SOLANA_MAINNET_RPC_URL to a private mainnet RPC endpoint.");
}
const connection = new Connection(rpcUrl, "confirmed");
if (CLUSTER === "mainnet-beta" && await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
  throw new Error("RPC genesis hash is not Solana mainnet.");
}
const b200 = deployment.indices.find((index) => index.symbol === "B200");
// The immutable DBC config quotes market caps in cmB200. Calibrate to the
// requested Pump-like USD targets using the observed Ornn B200 reference.
// Recheck this reference before creating a new config; later USD values drift
// with the B200 index even when the onchain cmB200 thresholds stay fixed.
const B200_USD_AT_CALIBRATION = Number(process.env.B200_USD_REFERENCE ?? (CLUSTER === "mainnet-beta" ? b200?.price : "8.06"));
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
    if (CLUSTER === "mainnet-beta") {
      const state = await new DynamicBondingCurveClient(connection, "confirmed").state.getPoolConfig(existing);
      if (!state?.feeClaimer.equals(new PublicKey(deployment.feeRecipient))
          || !state.quoteMint.equals(new PublicKey(b200.mint))) {
        throw new Error("Existing mainnet DBC config has the wrong fee claimer or quote mint.");
      }
    }
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
if (CLUSTER === "mainnet-beta" && deployment.feeRecipient !== payer.publicKey.toBase58()) {
  throw new Error("Mainnet DBC fee claimer must be the configured CMX fee recipient.");
}
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

await writeFile(OUTPUT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify({ config: deployment.dbc.config, signature }, null, 2));
