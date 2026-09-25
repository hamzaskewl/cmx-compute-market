import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DynamicBondingCurveClient,
  TokenDecimal,
  deriveDammV2PoolAddress,
  deriveDbcPoolAuthority,
  getPriceFromSqrtPrice,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  Connection,
  PublicKey,
  type TokenBalance,
} from "@solana/web3.js";
import BN from "bn.js";
import type { DbcMarket, MarketTrade, SolanaCluster } from "@/lib/market-types";
import { readServerDeployment } from "@/lib/server-deployment";

type DeploymentFile = {
  cluster: SolanaCluster;
  rpcUrl: string;
  dbc: {
    config: string;
    quoteMint: string;
    tradingFeeBps: number;
    migrationFeeOption?: number;
    migrationQuoteThreshold?: string;
  };
};

type MarketContext = {
  connection: Connection;
  dbc: DynamicBondingCurveClient;
  deployment: DeploymentFile;
};

type RpcTransaction = {
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
};

type RpcTransactionResponse = {
  id: number;
  result?: RpcTransaction | null;
  error?: { code: number; message: string };
};

const CACHE_MS = 15_000;
const marketCache = new Map<string, { market: DbcMarket; expiresAt: number }>();
const swapDescriptorCache = new Map<string, { baseMint: string; quoteMint: string; poolAuthority: string }>();
let listCache: { markets: DbcMarket[]; expiresAt: number } | null = null;
let contextPromise: Promise<MarketContext> | null = null;

async function retryRpc<T>(task: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function context(): Promise<MarketContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const deployment = await readServerDeployment<DeploymentFile>();
      const connection = new Connection(
        process.env.SOLANA_RPC_URL ?? deployment.rpcUrl,
        {
          commitment: "confirmed",
          disableRetryOnRateLimit: true,
          wsEndpoint: process.env.SOLANA_WSS_URL,
        },
      );
      return {
        connection,
        dbc: new DynamicBondingCurveClient(connection, "confirmed"),
        deployment,
      };
    })();
  }
  return contextPromise;
}

function amount(balance: TokenBalance) {
  return Number(balance.uiTokenAmount.uiAmountString ?? "0");
}

function poolDelta(
  pre: readonly TokenBalance[],
  post: readonly TokenBalance[],
  mint: string,
  poolAuthority: string,
) {
  const ownerByIndex = new Map<number, string>();
  for (const item of [...pre, ...post]) {
    if (item.owner) ownerByIndex.set(item.accountIndex, item.owner);
  }
  const sum = (items: readonly TokenBalance[]) => items.reduce((total, item) => {
    const owner = item.owner ?? ownerByIndex.get(item.accountIndex);
    return item.mint === mint && owner === poolAuthority ? total + amount(item) : total;
  }, 0);
  return sum(post) - sum(pre);
}

function parseSwap(
  signature: string,
  transaction: RpcTransaction | null,
  baseMint: string,
  quoteMint: string,
  poolAuthority: string,
): MarketTrade | null {
  if (!transaction?.meta || transaction.meta.err || !transaction.blockTime) return null;
  const pre = transaction.meta.preTokenBalances ?? [];
  const post = transaction.meta.postTokenBalances ?? [];
  const baseDelta = poolDelta(pre, post, baseMint, poolAuthority);
  const quoteDelta = poolDelta(pre, post, quoteMint, poolAuthority);

  // A swap moves the two pool vaults in opposite directions. Pool creation,
  // metadata writes, and fee claims are deliberately excluded.
  if (!Number.isFinite(baseDelta) || !Number.isFinite(quoteDelta)
    || Math.abs(baseDelta) < Number.EPSILON
    || Math.abs(quoteDelta) < Number.EPSILON
    || Math.sign(baseDelta) === Math.sign(quoteDelta)) return null;

  const baseAmount = Math.abs(baseDelta);
  const quoteAmount = Math.abs(quoteDelta);
  const priceInPair = quoteAmount / baseAmount;
  if (!Number.isFinite(priceInPair) || priceInPair <= 0) return null;
  return {
    signature,
    timestamp: transaction.blockTime * 1000,
    side: quoteDelta > 0 ? "buy" : "sell",
    priceInPair,
    baseAmount,
    quoteAmount,
  };
}

async function getTransactionIndividually(
  connection: Connection,
  signature: string,
  attempts: number,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(connection.rpcEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [signature, {
            encoding: "jsonParsed",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          }],
        }),
        cache: "no-store",
      });
      if (response.ok) {
        const item = await response.json() as RpcTransactionResponse;
        if (!item.error && item.result) return item.result;
      }
    } catch {
      // Retry throttled or transient provider responses below.
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  return null;
}

async function getTransactionsIndividually(connection: Connection, signatures: string[]) {
  const transactions = new Map<string, RpcTransaction | null>();
  for (let offset = 0; offset < signatures.length; offset += 4) {
    const group = signatures.slice(offset, offset + 4);
    const results = await Promise.all(group.map((signature) => (
      getTransactionIndividually(connection, signature, 3)
    )));
    group.forEach((signature, groupIndex) => transactions.set(signature, results[groupIndex]));
    if (offset + 4 < signatures.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Helius Free can throttle a burst while still serving the same calls a
  // moment later. Recover only the missing entries sequentially so a partial
  // provider response cannot silently understate candles or volume.
  for (const signature of signatures) {
    if (transactions.get(signature)) continue;
    await new Promise((resolve) => setTimeout(resolve, 150));
    transactions.set(
      signature,
      await getTransactionIndividually(connection, signature, 4),
    );
  }
  return transactions;
}

async function getTransactionsBatch(connection: Connection, signatures: string[]) {
  const transactions = new Map<string, RpcTransaction | null>();
  for (let index = 0; index < signatures.length; index += 40) {
    const batch = signatures.slice(index, index + 40);
    const response = await fetch(connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch.map((signature, offset) => ({
        jsonrpc: "2.0",
        id: offset + 1,
        method: "getTransaction",
        params: [signature, {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }],
      }))),
      cache: "no-store",
    });
    if (!response.ok) {
      return getTransactionsIndividually(connection, signatures);
    }
    const payload = await response.json() as RpcTransactionResponse[] | RpcTransactionResponse;
    if (!Array.isArray(payload)) {
      // Helius Free intentionally rejects JSON-RPC batches. Fall back to
      // bounded individual requests so the same server configuration still
      // supports truthful historical candles and reconnect recovery.
      return getTransactionsIndividually(connection, signatures);
    }
    const byId = new Map(payload.map((item) => [item.id, item]));
    batch.forEach((signature, offset) => {
      const item = byId.get(offset + 1);
      transactions.set(signature, item?.error ? null : item?.result ?? null);
    });
    const missing = batch.filter((signature) => transactions.get(signature) === null);
    if (missing.length) {
      const recovered = await getTransactionsIndividually(connection, missing);
      for (const signature of missing) {
        transactions.set(signature, recovered.get(signature) ?? null);
      }
    }
  }
  return transactions;
}

async function getSwapDescriptor(pool: PublicKey) {
  const address = pool.toBase58();
  const cached = swapDescriptorCache.get(address);
  if (cached) return cached;
  const marketContext = await context();
  const entry = await retryRpc(() => marketContext.dbc.state.getPool(pool));
  if (!entry) return null;
  const state = "poolState" in entry ? entry.poolState : entry;
  if (!state.config.equals(new PublicKey(marketContext.deployment.dbc.config))) return null;
  const descriptor = {
    baseMint: state.baseMint.toBase58(),
    quoteMint: marketContext.deployment.dbc.quoteMint,
    poolAuthority: deriveDbcPoolAuthority().toBase58(),
  };
  swapDescriptorCache.set(address, descriptor);
  return descriptor;
}

export async function getMarketRpcConnection() {
  return (await context()).connection;
}

export async function getMarketCluster() {
  return (await context()).deployment.cluster;
}

export async function getMarketTrade(address: string, signature: string) {
  const pool = new PublicKey(address);
  const [marketContext, descriptor] = await Promise.all([context(), getSwapDescriptor(pool)]);
  if (!descriptor) return null;

  // A confirmed log can precede getTransaction availability by a few hundred
  // milliseconds. Retry briefly instead of dropping a real swap from the tape.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const transactions = await getTransactionsBatch(marketContext.connection, [signature]);
    const transaction = transactions.get(signature) ?? null;
    if (transaction) {
      return parseSwap(
        signature,
        transaction,
        descriptor.baseMint,
        descriptor.quoteMint,
        descriptor.poolAuthority,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return null;
}

async function getPoolActivity(
  connection: Connection,
  pool: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  limit = 200,
) {
  const signatures = await retryRpc(() => connection.getSignaturesForAddress(
    pool,
    { limit },
    "confirmed",
  ));
  const transactions = await getTransactionsBatch(connection, signatures.map((item) => item.signature));

  const authority = deriveDbcPoolAuthority().toBase58();
  const trades = signatures
    .map(({ signature }) => parseSwap(
      signature,
      transactions.get(signature) ?? null,
      baseMint.toBase58(),
      quoteMint.toBase58(),
      authority,
    ))
    .filter((trade): trade is MarketTrade => Boolean(trade))
    .sort((left, right) => left.timestamp - right.timestamp);

  const successfulTimes = signatures
    .filter((item) => !item.err && item.blockTime)
    .map((item) => item.blockTime! * 1000);
  return {
    trades,
    createdAt: successfulTimes.length ? Math.min(...successfulTimes) : null,
  };
}

async function buildMarket(
  marketContext: MarketContext,
  publicKey: PublicKey,
  account: Awaited<ReturnType<DynamicBondingCurveClient["state"]["getPoolsByConfig"]>>[number]["account"],
  includeActivity: boolean,
  activityLimit = 200,
): Promise<DbcMarket> {
  const { dbc, connection, deployment } = marketContext;
  const state = "poolState" in account ? account.poolState : account;
  const [metadata, progress, activity, config] = await Promise.all([
    dbc.state.getPoolMetadata(publicKey).catch(() => []),
    dbc.state.getPoolQuoteTokenCurveProgress(publicKey).catch(() => 0),
    includeActivity
      ? getPoolActivity(connection, publicKey, state.baseMint, new PublicKey(deployment.dbc.quoteMint), activityLimit)
        .catch(() => ({ trades: [] as MarketTrade[], createdAt: null as number | null }))
      : Promise.resolve({ trades: [] as MarketTrade[], createdAt: null as number | null }),
    retryRpc(() => dbc.state.getPoolConfig(state.config)).catch(() => null),
  ]);
  const details = metadata[0];
  const trades = activity.trades;
  const firstPrice = trades[0]?.priceInPair;
  const lastPrice = trades.at(-1)?.priceInPair;
  const changePercent = firstPrice && lastPrice && trades.length > 1
    ? ((lastPrice - firstPrice) / firstPrice) * 100
    : null;
  const migrated = Boolean(state.isMigrated);
  const migrationThreshold = config?.migrationQuoteThreshold
    ?? (deployment.dbc.migrationQuoteThreshold
      ? new BN(deployment.dbc.migrationQuoteThreshold)
      : null);
  const migrationReady = migrationThreshold
    ? state.quoteReserve.gte(migrationThreshold)
    : progress >= 1;
  const migrationFeeOption = config
    ? Number(config.migrationFeeOption)
    : deployment.dbc.migrationFeeOption;
  const dammConfig = migrationFeeOption !== undefined
    ? DAMM_V2_MIGRATION_FEE_ADDRESS[migrationFeeOption]
    : null;
  const graduatedPool = dammConfig
    ? deriveDammV2PoolAddress(
      dammConfig,
      state.baseMint,
      new PublicKey(deployment.dbc.quoteMint),
    ).toBase58()
    : null;

  return {
    address: publicKey.toBase58(),
    creator: state.creator.toBase58(),
    mint: state.baseMint.toBase58(),
    cluster: deployment.cluster,
    pairSymbol: "B200",
    name: details?.name || `B200 launch ${state.baseMint.toBase58().slice(0, 5)}`,
    website: details?.website || "",
    logo: details?.logo || "",
    feePercent: deployment.dbc.tradingFeeBps / 100,
    priceInPair: Number(getPriceFromSqrtPrice(
      state.sqrtPrice,
      TokenDecimal.SIX,
      TokenDecimal.SIX,
    ).toString()),
    quoteReserve: Number(state.quoteReserve.toString()) / 1_000_000,
    progressPercent: progress * 100,
    migrationReady,
    migrated,
    graduatedPool,
    createdAt: activity.createdAt,
    lastTradeAt: trades.at(-1)?.timestamp ?? null,
    tradeCount: trades.length,
    volumeQuote: trades.reduce((total, trade) => total + trade.quoteAmount, 0),
    changePercent,
    history: trades.map((trade) => ({
      timestamp: trade.timestamp,
      priceInPair: trade.priceInPair,
      volumeQuote: trade.quoteAmount,
      side: trade.side,
    })),
    trades: [...trades].reverse(),
    dexScreenerUrl: migrated && deployment.cluster === "mainnet-beta" && graduatedPool
      ? `https://dexscreener.com/solana/${graduatedPool}`
      : null,
  };
}

export async function getDbcMarkets(options: { includeActivity?: boolean; fresh?: boolean } = {}) {
  if (!options.fresh && listCache && listCache.expiresAt > Date.now()) return listCache.markets;
  const marketContext = await context();
  const pools = await retryRpc(() => marketContext.dbc.state.getPoolsByConfig(
    new PublicKey(marketContext.deployment.dbc.config),
  ));
  const markets: DbcMarket[] = [];
  for (const { publicKey, account } of pools) {
    markets.push(await buildMarket(
      marketContext,
      publicKey,
      account,
      options.includeActivity ?? true,
      40,
    ));
    if (options.includeActivity ?? true) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const sorted = markets.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  const expiresAt = Date.now() + CACHE_MS;
  listCache = { markets: sorted, expiresAt };
  for (const market of sorted) marketCache.set(market.address, { market, expiresAt });
  return sorted;
}

export async function getDbcMarket(address: string, options: { fresh?: boolean } = {}) {
  const pool = new PublicKey(address);
  const cached = marketCache.get(pool.toBase58());
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.market;
  const marketContext = await context();
  const entry = await retryRpc(() => marketContext.dbc.state.getPool(pool));
  if (!entry) return null;
  const state = "poolState" in entry ? entry.poolState : entry;
  if (!state.config.equals(new PublicKey(marketContext.deployment.dbc.config))) return null;
  const market = await buildMarket(marketContext, pool, entry, true);
  marketCache.set(market.address, { market, expiresAt: Date.now() + CACHE_MS });
  return market;
}
