import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DynamicBondingCurveClient,
  TokenDecimal,
  deriveDammV2PoolAddress,
  deriveDbcPoolAuthority,
  getPriceFromSqrtPrice,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, derivePoolAuthority as deriveDammPoolAuthority, getPriceFromSqrtPrice as getDammPrice } from "@meteora-ag/cp-amm-sdk";
import {
  Connection,
  PublicKey,
  type TokenBalance,
} from "@solana/web3.js";
import BN from "bn.js";
import type { DbcMarket, MarketTrade, SolanaCluster } from "@/lib/market-types";
import { readSelectedNetwork, readServerDeployment } from "@/lib/server-deployment";

type DeploymentFile = {
  cluster: SolanaCluster;
  rpcUrl: string;
  dbc: {
    config: string;
    quoteMint: string;
    tradingFeeBps: number;
    initialMarketCapInQuote?: number;
    migrationMarketCapInQuote?: number;
    migrationFeeOption?: number;
    migrationQuoteThreshold?: string;
    previousConfigs?: {
      config: string;
      tradingFeeBps: number;
      initialMarketCapInQuote?: number;
      migrationMarketCapInQuote?: number;
    }[];
  };
};

type MarketContext = {
  connection: Connection;
  dbc: DynamicBondingCurveClient;
  damm: CpAmm;
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

const CACHE_MS = 30_000;
const ACTIVITY_CACHE_MS = 5 * 60_000;
const TRANSACTION_CACHE_LIMIT = 1_500;
const TOKEN_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const marketCache = new Map<string, { market: DbcMarket; expiresAt: number }>();
const swapDescriptorCache = new Map<string, { baseMint: string; quoteMint: string; poolAuthority: string }>();
const listCache = new Map<string, { markets: DbcMarket[]; expiresAt: number }>();
const listPromises = new Map<string, Promise<DbcMarket[]>>();
const marketRefreshes = new Map<string, Promise<DbcMarket | null>>();
const contextPromises = new Map<SolanaCluster, Promise<MarketContext>>();
// Confirmed transactions are immutable. Reusing their balance deltas prevents
// every page visit and stream reconnect from rereading the same swap history.
const transactionCache = new Map<string, RpcTransaction>();

function cacheKey(network: SolanaCluster, address: string) { return `${network}:${address}`; }

async function retryRpc<T>(task: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function context(network?: SolanaCluster): Promise<MarketContext> {
  const selected = network ?? await readSelectedNetwork();
  let contextPromise = contextPromises.get(selected);
  if (!contextPromise) {
    contextPromise = (async () => {
      const deployment = await readServerDeployment<DeploymentFile>(selected);
      const connection = new Connection(
        selected === "devnet"
          ? process.env.SOLANA_DEVNET_RPC_URL ?? process.env.SOLANA_RPC_URL ?? deployment.rpcUrl
          : process.env.SOLANA_MAINNET_RPC_URL ?? deployment.rpcUrl,
        {
          commitment: "confirmed",
          disableRetryOnRateLimit: true,
          wsEndpoint: selected === "devnet" ? process.env.SOLANA_DEVNET_WSS_URL ?? process.env.SOLANA_WSS_URL : process.env.SOLANA_MAINNET_WSS_URL,
        },
      );
      return {
        connection,
        dbc: new DynamicBondingCurveClient(connection, "confirmed"),
        damm: new CpAmm(connection),
        deployment,
      };
    })();
    contextPromises.set(selected, contextPromise);
    void contextPromise.catch(() => contextPromises.delete(selected));
  }
  return contextPromise;
}

function acceptedConfigs(deployment: DeploymentFile) {
  return new Set([
    deployment.dbc.config,
    ...(deployment.dbc.previousConfigs ?? []).map((entry) => entry.config),
  ]);
}

async function getMintSymbol(connection: Connection, mint: PublicKey) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM,
  );
  const account = await connection.getAccountInfo(metadata);
  if (!account) return "";
  const bytes = account.data;
  // Metaplex Metadata V1: key, update authority, mint, then Borsh strings.
  let offset = 65;
  for (let field = 0; field < 2; field += 1) {
    if (offset + 4 > bytes.length) return "";
    const length = bytes.readUInt32LE(offset);
    offset += 4;
    if (length > 200 || offset + length > bytes.length) return "";
    const value = bytes.subarray(offset, offset + length).toString("utf8").replace(/\0/g, "").trim();
    offset += length;
    if (field === 1) return value;
  }
  return "";
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
    // cmB200 has six decimals. A few raw units of quote output can make
    // execution-price division look like a large market move on tiny swaps.
    priceReliable: quoteAmount >= 0.0001,
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
  // A pruned or throttled RPC can omit older transactions. Keep the swaps it
  // did return so a single missing record does not blank the whole chart.
  return transactions;
}

async function getTransactionsBatchUncached(connection: Connection, signatures: string[]) {
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

async function getTransactionsBatch(connection: Connection, signatures: string[]) {
  const transactions = new Map<string, RpcTransaction | null>();
  const missing: string[] = [];
  for (const signature of signatures) {
    const cached = transactionCache.get(signature);
    if (cached) transactions.set(signature, cached);
    else missing.push(signature);
  }
  if (!missing.length) return transactions;
  const fetched = await getTransactionsBatchUncached(connection, missing);
  for (const signature of missing) {
    const result = fetched.get(signature) ?? null;
    transactions.set(signature, result);
    if (!result) continue;
    transactionCache.set(signature, {
      blockTime: result.blockTime,
      meta: result.meta ? {
        err: result.meta.err,
        preTokenBalances: result.meta.preTokenBalances,
        postTokenBalances: result.meta.postTokenBalances,
      } : null,
    });
    if (transactionCache.size > TRANSACTION_CACHE_LIMIT) {
      transactionCache.delete(transactionCache.keys().next().value!);
    }
  }
  return transactions;
}

async function getSwapDescriptor(pool: PublicKey) {
  const marketContext = await context();
  const address = cacheKey(marketContext.deployment.cluster, pool.toBase58());
  const cached = swapDescriptorCache.get(address);
  if (cached) return cached;
  const entry = await retryRpc(() => marketContext.dbc.state.getPool(pool));
  if (!entry) return null;
  const state = "poolState" in entry ? entry.poolState : entry;
  if (!acceptedConfigs(marketContext.deployment).has(state.config.toBase58())) return null;
  const descriptor = {
    baseMint: state.baseMint.toBase58(),
    quoteMint: marketContext.deployment.dbc.quoteMint,
    poolAuthority: deriveDbcPoolAuthority().toBase58(),
  };
  swapDescriptorCache.set(address, descriptor);
  return descriptor;
}

export async function getMarketRpcConnection(network?: SolanaCluster) {
  return (await context(network)).connection;
}

export async function getMarketCluster() {
  return (await context()).deployment.cluster;
}

export async function getMarketTrade(address: string, signature: string, market?: DbcMarket) {
  const pool = new PublicKey(address);
  const marketContext = await context(market?.cluster);
  const descriptor = market
    ? {
      baseMint: market.mint,
      quoteMint: marketContext.deployment.dbc.quoteMint,
      poolAuthority: (market.migrated ? deriveDammPoolAuthority() : deriveDbcPoolAuthority()).toBase58(),
    }
    : await getSwapDescriptor(pool);
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
  poolAuthority = deriveDbcPoolAuthority().toBase58(),
) {
  const signatures = await retryRpc(() => connection.getSignaturesForAddress(pool, { limit: 1000 }, "confirmed"));
  const transactions = await getTransactionsBatch(connection, signatures.slice(0, limit).map((item) => item.signature));

  const trades = signatures.slice(0, limit)
    .map(({ signature }) => parseSwap(
      signature,
      transactions.get(signature) ?? null,
      baseMint.toBase58(),
      quoteMint.toBase58(),
      poolAuthority,
    ))
    .filter((trade): trade is MarketTrade => Boolean(trade))
    .sort((left, right) => left.timestamp - right.timestamp);

  // Follow older signature pages when a pool has more than 1,000 actions.
  // If the RPC history is too deep to finish, report an unknown creation date.
  let oldestPage = signatures;
  let pages = 1;
  while (oldestPage.length === 1000 && pages < 10) {
    oldestPage = await retryRpc(() => connection.getSignaturesForAddress(
      pool, { limit: 1000, before: oldestPage.at(-1)!.signature }, "confirmed",
    ));
    pages += 1;
  }
  const successfulTimes = oldestPage
    .filter((item) => !item.err && item.blockTime)
    .map((item) => item.blockTime! * 1000);
  return {
    trades,
    createdAt: oldestPage.length < 1000 && successfulTimes.length ? Math.min(...successfulTimes) : null,
  };
}

async function buildMarket(
  marketContext: MarketContext,
  publicKey: PublicKey,
  account: Awaited<ReturnType<DynamicBondingCurveClient["state"]["getPoolsByConfig"]>>[number]["account"],
  includeActivity: boolean,
  activityLimit = 200,
): Promise<DbcMarket> {
  const { dbc, damm, connection, deployment } = marketContext;
  const state = "poolState" in account ? account.poolState : account;
  const [metadata, progress, config, symbol, tokenSupply] = await Promise.all([
    retryRpc(() => dbc.state.getPoolMetadata(publicKey)).catch(() => []),
    retryRpc(() => dbc.state.getPoolQuoteTokenCurveProgress(publicKey)),
    retryRpc(() => dbc.state.getPoolConfig(state.config)),
    retryRpc(() => getMintSymbol(connection, state.baseMint)),
    retryRpc(() => connection.getTokenSupply(state.baseMint)).then((value) => Number(value.value.uiAmountString)),
  ]);
  const activity = includeActivity
    ? await getPoolActivity(connection, publicKey, state.baseMint, new PublicKey(deployment.dbc.quoteMint), activityLimit)
    : { trades: [] as MarketTrade[], createdAt: null as number | null };
  const details = metadata[0];
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
  const curvePrice = Number(getPriceFromSqrtPrice(
    state.sqrtPrice, TokenDecimal.SIX, TokenDecimal.SIX,
  ).toString());
  let migratedPrice: number | null = null;
  if (migrated && graduatedPool) {
    try {
      const pool = await retryRpc(() => damm.fetchPoolState(new PublicKey(graduatedPool)));
      const price = Number(getDammPrice(pool.sqrtPrice, 6, 6).toString());
      if (pool.tokenAMint.equals(state.baseMint) && pool.tokenBMint.equals(new PublicKey(deployment.dbc.quoteMint))) {
        migratedPrice = price;
      } else if (pool.tokenBMint.equals(state.baseMint) && pool.tokenAMint.equals(new PublicKey(deployment.dbc.quoteMint))) {
        migratedPrice = 1 / price;
      }
    } catch {
      // The migrated pool may not be indexed immediately after migration.
    }
  }
  const marketPrice = migratedPrice ?? curvePrice;
  const graduatedActivity = includeActivity && migrated && graduatedPool && migratedPrice !== null
    ? await getPoolActivity(
      connection,
      new PublicKey(graduatedPool),
      state.baseMint,
      new PublicKey(deployment.dbc.quoteMint),
      activityLimit,
      deriveDammPoolAuthority().toBase58(),
    )
    : { trades: [] as MarketTrade[] };
  const trades = [...activity.trades, ...graduatedActivity.trades]
    .sort((left, right) => left.timestamp - right.timestamp);
  const pricedTrades = trades.filter((trade) => trade.priceReliable);
  const firstPrice = pricedTrades[0]?.priceInPair;
  const lastPrice = marketPrice;
  const curveTargets = state.config.toBase58() === deployment.dbc.config
    ? deployment.dbc
    : (deployment.dbc.previousConfigs ?? []).find((entry) => entry.config === state.config.toBase58());
  const changePercent = firstPrice && lastPrice && pricedTrades.length > 1
    ? ((lastPrice - firstPrice) / firstPrice) * 100
    : null;

  return {
    address: publicKey.toBase58(),
    creator: state.creator.toBase58(),
    mint: state.baseMint.toBase58(),
    cluster: deployment.cluster,
    pairSymbol: "B200",
    name: details?.name || `B200 launch ${state.baseMint.toBase58().slice(0, 5)}`,
    symbol: symbol || state.baseMint.toBase58().slice(0, 5),
    website: details?.website || "",
    logo: details?.logo || "",
    feePercent: config
      ? Number(config.poolFees.baseFee.cliffFeeNumerator.toString()) / 10_000_000
      : ((deployment.dbc.previousConfigs ?? []).find((entry) => entry.config === state.config.toBase58())?.tradingFeeBps
        ?? deployment.dbc.tradingFeeBps) / 100,
    priceInPair: marketPrice,
    marketCapQuote: migrated && migratedPrice === null ? null : tokenSupply * marketPrice,
    openingMarketCapQuote: curveTargets?.initialMarketCapInQuote ?? null,
    graduationMarketCapQuote: curveTargets?.migrationMarketCapInQuote ?? null,
    usesCurrentCurve: state.config.toBase58() === deployment.dbc.config,
    quoteReserve: Number(state.quoteReserve.toString()) / 1_000_000,
    progressPercent: progress * 100,
    migrationReady,
    migrated,
    graduatedPool,
    createdAt: activity.createdAt,
    lastTradeAt: trades.at(-1)?.timestamp ?? null,
    activityLoaded: includeActivity,
    tradeCount: trades.length,
    volumeQuote: trades.reduce((total, trade) => total + trade.quoteAmount, 0),
    changePercent,
    history: trades.map((trade) => ({
      timestamp: trade.timestamp,
      priceInPair: trade.priceInPair,
      priceReliable: trade.priceReliable,
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
  const marketContext = await context();
  const network = marketContext.deployment.cluster;
  const includeActivity = options.includeActivity ?? true;
  const key = `${network}:${includeActivity ? "full" : "summary"}`;
  const cached = listCache.get(key);
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.markets;
  const inflight = listPromises.get(key);
  // An expired snapshot is still useful while a fresh scan runs. Do not make
  // every visitor wait for the same historical transaction reads again.
  if (!options.fresh && cached) {
    if (!inflight) void getDbcMarkets({ ...options, fresh: true }).catch(() => undefined);
    return cached.markets;
  }
  if (inflight) return inflight;
  const listPromise = (async () => {
    const poolsByConfig = await Promise.all([...acceptedConfigs(marketContext.deployment)].map((config) => (
      retryRpc(() => marketContext.dbc.state.getPoolsByConfig(new PublicKey(config)))
    )));
    const pools = poolsByConfig.flat();
    const markets: DbcMarket[] = [];
    for (let offset = 0; offset < pools.length; offset += 2) {
      const group = await Promise.all(pools.slice(offset, offset + 2).map(({ publicKey, account }) => (
        buildMarket(marketContext, publicKey, account, includeActivity, 40)
      )));
      markets.push(...group);
    }
    const sorted = markets.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
    const expiresAt = Date.now() + (includeActivity ? ACTIVITY_CACHE_MS : CACHE_MS);
    listCache.set(key, { markets: sorted, expiresAt });
    if (includeActivity) listCache.set(`${network}:summary`, { markets: sorted, expiresAt: Date.now() + CACHE_MS });
    for (const market of sorted) {
      const address = cacheKey(network, market.address);
      const previous = marketCache.get(address);
      if (includeActivity || !previous?.market.activityLoaded || previous.expiresAt <= Date.now()) {
        marketCache.set(address, { market, expiresAt: Date.now() + CACHE_MS });
      }
    }
    return sorted;
  })();
  listPromises.set(key, listPromise);
  try { return await listPromise; }
  catch (error) {
    if (cached) return cached.markets;
    throw error;
  }
  finally { listPromises.delete(key); }
}

export async function getDbcMarket(address: string, options: { fresh?: boolean; network?: SolanaCluster; includeActivity?: boolean } = {}) {
  const pool = new PublicKey(address);
  const marketContext = await context(options.network);
  const network = marketContext.deployment.cluster;
  const key = cacheKey(network, pool.toBase58());
  const cached = marketCache.get(key);
  const includeActivity = options.includeActivity ?? true;
  if (!options.fresh && cached && (cached.market.activityLoaded || !includeActivity)) {
    if (cached.expiresAt <= Date.now() && !marketRefreshes.has(key)) {
      const refresh = getDbcMarket(address, { ...options, fresh: true });
      marketRefreshes.set(key, refresh);
      void refresh.then(() => marketRefreshes.delete(key), () => marketRefreshes.delete(key));
    }
    return cached.market;
  }
  try {
    const entry = await retryRpc(() => marketContext.dbc.state.getPool(pool));
    if (!entry) return null;
    const state = "poolState" in entry ? entry.poolState : entry;
    if (!acceptedConfigs(marketContext.deployment).has(state.config.toBase58())) return null;
    let market: DbcMarket;
    try {
      market = await buildMarket(marketContext, pool, entry, includeActivity);
    } catch {
      if (cached) return cached.market;
      console.warn("Market history is delayed; serving current pool state.");
      market = await buildMarket(marketContext, pool, entry, false);
    }
    marketCache.set(key, { market, expiresAt: Date.now() + CACHE_MS });
    return market;
  } catch (error) {
    if (cached) return cached.market;
    throw error;
  }
}
