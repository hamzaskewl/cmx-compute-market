import { Keypair } from "@solana/web3.js";

export const DBC_PROGRAM_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

function integerInRange(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export function readMigratorSettings(env, deployment) {
  const cluster = env.SOLANA_CLUSTER ?? "devnet";
  if (cluster !== "devnet" && cluster !== "mainnet-beta") {
    throw new Error("SOLANA_CLUSTER must be devnet or mainnet-beta.");
  }
  if (deployment?.cluster !== cluster || !deployment?.dbc?.config || !deployment?.dbc?.quoteMint) {
    throw new Error(`A complete deployment/${cluster}.json manifest is required.`);
  }
  if (deployment.dbc.programId !== DBC_PROGRAM_ID) {
    throw new Error("The manifest DBC program does not match the installed Meteora SDK.");
  }
  const enabled = env.MIGRATOR_ENABLED === "true";
  if (enabled && cluster === "mainnet-beta" && env.MIGRATOR_ENABLE_MAINNET !== "true") {
    throw new Error("Mainnet migration requires MIGRATOR_ENABLE_MAINNET=true.");
  }
  if (enabled && cluster === "mainnet-beta" && !deployment.feeRecipient) {
    throw new Error("Mainnet migration requires a fee recipient in the manifest.");
  }
  if (enabled && !env.MIGRATOR_EXPECTED_GENESIS_HASH) {
    throw new Error("MIGRATOR_EXPECTED_GENESIS_HASH is required when signing is enabled.");
  }
  if (enabled && !env.MIGRATOR_KEYPAIR_JSON) {
    throw new Error("MIGRATOR_KEYPAIR_JSON is required when signing is enabled.");
  }
  if (enabled && cluster === "mainnet-beta" && env.MIGRATOR_EXPECTED_GENESIS_HASH !== MAINNET_GENESIS_HASH) {
    throw new Error("MIGRATOR_EXPECTED_GENESIS_HASH must be Solana mainnet.");
  }
  const mainnetRpc = env.SOLANA_MAINNET_RPC_URL ?? env.SOLANA_RPC_URL;
  if (enabled && cluster === "mainnet-beta" && (!mainnetRpc || mainnetRpc.includes("api.mainnet-beta.solana.com"))) {
    throw new Error("Mainnet migration requires a private mainnet RPC endpoint.");
  }
  const scanMs = integerInRange(env.MIGRATOR_SCAN_MS, 2_000, 1_000, 60_000, "MIGRATOR_SCAN_MS");
  const priorityFee = integerInRange(
    env.MIGRATOR_PRIORITY_FEE_MICROLAMPORTS,
    0,
    0,
    1_000_000,
    "MIGRATOR_PRIORITY_FEE_MICROLAMPORTS",
  );
  const configs = [deployment.dbc.config, ...(deployment.dbc.previousConfigs ?? []).map((entry) => entry.config)];
  return {
    cluster,
    enabled,
    scanMs,
    priorityFee,
    expectedGenesisHash: env.MIGRATOR_EXPECTED_GENESIS_HASH ?? null,
    rpcUrl: cluster === "devnet"
      ? env.SOLANA_DEVNET_RPC_URL ?? env.SOLANA_RPC_URL ?? deployment.rpcUrl
      : env.SOLANA_MAINNET_RPC_URL ?? env.SOLANA_RPC_URL ?? deployment.rpcUrl,
    wsUrl: cluster === "devnet"
      ? env.SOLANA_DEVNET_WSS_URL ?? env.SOLANA_WSS_URL
      : env.SOLANA_MAINNET_WSS_URL ?? env.SOLANA_WSS_URL,
    configs: [...new Set(configs)],
    quoteMint: deployment.dbc.quoteMint,
  };
}

export function loadMigratorKeypair(json) {
  let secret;
  try {
    secret = JSON.parse(json);
  } catch {
    throw new Error("MIGRATOR_KEYPAIR_JSON must be a Solana 64-byte secret key JSON array.");
  }
  if (!Array.isArray(secret) || secret.length !== 64 || secret.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("MIGRATOR_KEYPAIR_JSON must be a Solana 64-byte secret key JSON array.");
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function isMigrationReady(pool, config, expectedConfig) {
  const state = pool?.poolState;
  return Boolean(
    state &&
    state.config?.equals(expectedConfig) &&
    Number(state.isMigrated) === 0 &&
    state.quoteReserve?.gte(config.migrationQuoteThreshold),
  );
}
