import assert from "node:assert/strict";
import test from "node:test";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  DBC_PROGRAM_ID,
  MAINNET_GENESIS_HASH,
  isMigrationReady,
  loadMigratorKeypair,
  readMigratorSettings,
} from "../scripts/auto-migrate-core.mjs";

const configAddress = Keypair.generate().publicKey.toBase58();
const quoteMint = Keypair.generate().publicKey.toBase58();
const manifest = {
  cluster: "devnet",
  dbc: { programId: DBC_PROGRAM_ID, config: configAddress, quoteMint },
};

test("signing is opt-in and bound to the configured RPC genesis", () => {
  const dryRun = readMigratorSettings({}, manifest);
  assert.equal(dryRun.enabled, false);
  assert.equal(dryRun.scanMs, 2_000);
  assert.deepEqual(dryRun.configs, [configAddress]);
  assert.throws(() => readMigratorSettings({ MIGRATOR_ENABLED: "true" }, manifest), /GENESIS_HASH/);
  assert.throws(() => readMigratorSettings({
    MIGRATOR_ENABLED: "true",
    MIGRATOR_EXPECTED_GENESIS_HASH: "expected",
  }, manifest), /KEYPAIR_JSON/);
  assert.throws(() => readMigratorSettings({ SOLANA_CLUSTER: "mainnet-beta" }, manifest), /complete deployment/);
  assert.throws(() => readMigratorSettings({ MIGRATOR_SCAN_MS: "0" }, manifest), /MIGRATOR_SCAN_MS/);
  const fallback = readMigratorSettings({
    SOLANA_RPC_URL: "https://private.example",
    SOLANA_DEVNET_RPC_URL: "https://api.devnet.solana.com",
    SOLANA_DEVNET_WSS_URL: "wss://api.devnet.solana.com",
  }, manifest);
  assert.equal(fallback.rpcUrl, "https://api.devnet.solana.com");
  assert.equal(fallback.wsUrl, "wss://api.devnet.solana.com");
});

test("mainnet signing requires a separate explicit flag and manifest", () => {
  const mainnetManifest = { ...manifest, cluster: "mainnet-beta", feeRecipient: Keypair.generate().publicKey.toBase58() };
  const env = {
    SOLANA_CLUSTER: "mainnet-beta",
    MIGRATOR_ENABLED: "true",
    MIGRATOR_EXPECTED_GENESIS_HASH: MAINNET_GENESIS_HASH,
    MIGRATOR_KEYPAIR_JSON: "[]",
    SOLANA_MAINNET_RPC_URL: "https://private-mainnet.example",
    SOLANA_MAINNET_WSS_URL: "wss://private-mainnet.example",
  };
  assert.throws(() => readMigratorSettings(env, mainnetManifest), /MIGRATOR_ENABLE_MAINNET/);
  const settings = readMigratorSettings({ ...env, MIGRATOR_ENABLE_MAINNET: "true" }, mainnetManifest);
  assert.equal(settings.enabled, true);
  assert.equal(settings.rpcUrl, "https://private-mainnet.example");
  assert.equal(settings.wsUrl, "wss://private-mainnet.example");
  assert.throws(() => readMigratorSettings({ ...env, MIGRATOR_ENABLE_MAINNET: "true", MIGRATOR_EXPECTED_GENESIS_HASH: "devnet" }, mainnetManifest), /Solana mainnet/);
});

test("only an unmigrated pool at the exact configured threshold is eligible", () => {
  const config = new PublicKey(configAddress);
  const otherConfig = Keypair.generate().publicKey;
  const threshold = new BN(240_253_073);
  const pool = (reserve, isMigrated, poolConfig = config) => ({
    poolState: { config: poolConfig, quoteReserve: new BN(reserve), isMigrated },
  });
  assert.equal(isMigrationReady(pool(240_253_072, 0), { migrationQuoteThreshold: threshold }, config), false);
  assert.equal(isMigrationReady(pool(240_253_073, 0), { migrationQuoteThreshold: threshold }, config), true);
  assert.equal(isMigrationReady(pool(240_253_074, 1), { migrationQuoteThreshold: threshold }, config), false);
  assert.equal(isMigrationReady(pool(240_253_074, 0, otherConfig), { migrationQuoteThreshold: threshold }, config), false);
});

test("signer parser accepts only a Solana secret key array", () => {
  const wallet = Keypair.generate();
  assert.equal(loadMigratorKeypair(JSON.stringify([...wallet.secretKey])).publicKey.toBase58(), wallet.publicKey.toBase58());
  assert.throws(() => loadMigratorKeypair("{invalid"), /64-byte/);
  assert.throws(() => loadMigratorKeypair("[]"), /64-byte/);
});
