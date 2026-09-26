import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DynamicBondingCurveClient,
  MigrationOption,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DBC_PROGRAM_ID,
  isMigrationReady,
  loadMigratorKeypair,
  readMigratorSettings,
} from "./auto-migrate-core.mjs";

const startedAt = Date.now();
const metrics = {
  scans: 0,
  websocketUpdates: 0,
  eligible: 0,
  submitted: 0,
  confirmed: 0,
  failed: 0,
  rpcErrors: 0,
  lastSubmitLatencyMs: null,
  lastConfirmedAt: null,
};

function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), service: "dbc-migrator", event, ...fields }));
}

function errorKind(error) {
  // RPC errors may contain the credential-bearing URL. Never print their message or stack.
  if (error instanceof Error && /(?:\b429\b|rate.?limit)/i.test(error.message)) return "RateLimited";
  return error instanceof Error ? error.name : "UnknownError";
}

async function main() {
  const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
  if (cluster !== "devnet" && cluster !== "mainnet-beta") {
    throw new Error("SOLANA_CLUSTER must be devnet or mainnet-beta.");
  }
  const manifestPath = path.join(process.cwd(), "deployment", `${cluster}.json`);
  const deployment = JSON.parse(await readFile(manifestPath, "utf8"));
  const settings = readMigratorSettings(process.env, deployment);
  log("initializing", { cluster, configCount: settings.configs.length, mode: settings.enabled ? "signing" : "dry-run" });
  const connection = new Connection(settings.rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: settings.wsUrl,
    disableRetryOnRateLimit: true,
  });
  const genesisHash = await connection.getGenesisHash();
  log("rpc_verified", { cluster });
  if (settings.expectedGenesisHash && genesisHash !== settings.expectedGenesisHash) {
    throw new Error("The RPC genesis hash does not match MIGRATOR_EXPECTED_GENESIS_HASH.");
  }
  const signer = settings.enabled ? loadMigratorKeypair(process.env.MIGRATOR_KEYPAIR_JSON) : null;
  if (signer && cluster === "mainnet-beta" && signer.publicKey.toBase58() !== deployment.feeRecipient) {
    throw new Error("Mainnet migration signer does not match the fee recipient in the manifest.");
  }
  const balance = signer ? await connection.getBalance(signer.publicKey, "confirmed") : null;
  const dbc = new DynamicBondingCurveClient(connection, "confirmed");
  const program = dbc.state.getProgram();
  const configs = new Map();
  for (const address of settings.configs) {
    const key = new PublicKey(address);
    const config = await dbc.state.getPoolConfig(key);
    if (!config) throw new Error(`Configured DBC pool config ${address} does not exist.`);
    if (!config.quoteMint.equals(new PublicKey(settings.quoteMint))) {
      throw new Error(`Configured DBC pool config ${address} uses a different quote mint.`);
    }
    if (Number(config.migrationOption) !== MigrationOption.MET_DAMM_V2) {
      throw new Error(`Configured DBC pool config ${address} does not migrate to DAMM v2.`);
    }
    if (!DAMM_V2_MIGRATION_FEE_ADDRESS[Number(config.migrationFeeOption)]) {
      throw new Error(`Configured DBC pool config ${address} has an unsupported migration fee option.`);
    }
    configs.set(address, { key, config });
    log("config_verified", { cluster, verified: configs.size, total: settings.configs.length });
  }
  if (signer && balance === 0) log("unfunded_signer", { cluster, signer: signer.publicKey.toBase58() });
  log("started", {
    cluster,
    mode: settings.enabled ? "signing" : "dry-run",
    signer: signer?.publicKey.toBase58() ?? null,
    balanceLamports: balance,
    configCount: configs.size,
    scanMs: settings.scanMs,
    websocketFilters: configs.size,
  });

  const inFlight = new Set();
  const retryAfter = new Map();
  const dryRunLoggedAt = new Map();
  const subscriptions = [];
  let stopping = false;
  let scanRunning = false;
  let scanRetryAt = 0;
  let consecutiveScanFailures = 0;

  async function migrate(poolKey, configEntry, detectedAt) {
    const address = poolKey.toBase58();
    try {
      const latestPool = await dbc.state.getPool(poolKey);
      if (!isMigrationReady(latestPool, configEntry.config, configEntry.key)) return;
      metrics.eligible += 1;
      if (!signer) {
        const lastLogged = dryRunLoggedAt.get(address) ?? 0;
        if (Date.now() - lastLogged >= 60_000) {
          dryRunLoggedAt.set(address, Date.now());
          log("eligible_dry_run", { cluster, pool: address });
        }
        return;
      }
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[Number(configEntry.config.migrationFeeOption)];
      const migration = await dbc.migration.migrateToDammV2({
        payer: signer.publicKey,
        pool: poolKey,
        dammConfig,
      });
      const transaction = migration.transaction;
      if (settings.priorityFee > 0) {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: settings.priorityFee }),
        );
      }
      const blockhash = await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = signer.publicKey;
      transaction.recentBlockhash = blockhash.blockhash;
      transaction.sign(
        signer,
        migration.firstPositionNftKeypair,
        migration.secondPositionNftKeypair,
      );
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      metrics.submitted += 1;
      metrics.lastSubmitLatencyMs = Date.now() - detectedAt;
      log("submitted", {
        cluster,
        pool: address,
        signature,
        detectToSubmitMs: metrics.lastSubmitLatencyMs,
      });
      const result = await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
      if (result.value.err) throw new Error("Migration transaction failed onchain.");
      const migrated = await dbc.state.getPool(poolKey);
      if (Number(migrated?.poolState?.isMigrated) !== 1) {
        throw new Error("Migration confirmation was received but pool state has not updated.");
      }
      metrics.confirmed += 1;
      metrics.lastConfirmedAt = new Date().toISOString();
      log("confirmed", { cluster, pool: address, signature });
    } catch (error) {
      metrics.failed += 1;
      const kind = errorKind(error);
      retryAfter.set(address, Date.now() + (kind === "RateLimited" ? 30_000 : 10_000));
      log("attempt_failed", { cluster, pool: address, kind });
      // The next scan checks onchain state again. This also handles a transaction
      // that landed even when the RPC returned an ambiguous transport error.
    } finally {
      inFlight.delete(address);
    }
  }

  function consider(poolKey, pool, detectedAt) {
    if (stopping) return;
    const configAddress = pool?.poolState?.config?.toBase58();
    const entry = configs.get(configAddress);
    if (!entry || !isMigrationReady(pool, entry.config, entry.key)) return;
    const address = poolKey.toBase58();
    if (inFlight.has(address) || Date.now() < (retryAfter.get(address) ?? 0)) return;
    inFlight.add(address);
    void migrate(poolKey, entry, detectedAt);
  }

  // Subscribe before the first snapshot so a graduation cannot fall into a gap.
  for (const address of configs.keys()) {
    const id = connection.onProgramAccountChange(
      new PublicKey(DBC_PROGRAM_ID),
      ({ accountId, accountInfo }) => {
        metrics.websocketUpdates += 1;
        try {
          const pool = program.coder.accounts.decodeAny(accountInfo.data);
          consider(accountId, pool, Date.now());
        } catch {
          metrics.rpcErrors += 1;
          log("decode_failed", { cluster, pool: accountId.toBase58() });
        }
      },
      "confirmed",
      [{ memcmp: { offset: 72, bytes: address } }],
    );
    subscriptions.push(id);
  }

  async function scan() {
    if (stopping || scanRunning || Date.now() < scanRetryAt) return;
    scanRunning = true;
    metrics.scans += 1;
    try {
      for (const address of configs.keys()) {
        const pools = await dbc.state.getPoolsByConfig(address);
        for (const { publicKey, account } of pools) consider(publicKey, account, Date.now());
      }
      consecutiveScanFailures = 0;
    } catch (error) {
      metrics.rpcErrors += 1;
      const kind = errorKind(error);
      consecutiveScanFailures += 1;
      scanRetryAt = Date.now() + Math.min(60_000, settings.scanMs * 2 ** consecutiveScanFailures);
      log("scan_failed", { cluster, kind, retryInMs: scanRetryAt - Date.now() });
    } finally {
      scanRunning = false;
    }
  }

  await scan();
  const scanTimer = setInterval(() => void scan(), settings.scanMs);
  const metricsTimer = setInterval(() => {
    log("heartbeat", {
      cluster,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
      inFlight: inFlight.size,
      ...metrics,
    });
  }, 60_000);

  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(scanTimer);
    clearInterval(metricsTimer);
    await Promise.allSettled(subscriptions.map((id) => connection.removeProgramAccountChangeListener(id)));
    log("stopped", { cluster, inFlight: inFlight.size });
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error) => {
  log("startup_failed", { kind: errorKind(error) });
  process.exitCode = 1;
});
