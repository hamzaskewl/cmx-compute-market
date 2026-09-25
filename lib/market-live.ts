import { PublicKey } from "@solana/web3.js";
import { getMarketRpcConnection, getMarketTrade } from "@/lib/dbc-markets";
import type { DbcMarket, MarketTrade } from "@/lib/market-types";

type TradeListener = (trade: MarketTrade) => void;

type StreamEntry = {
  listeners: Set<TradeListener>;
  subscriptionId: number | null;
  starting: Promise<void> | null;
  teardown: ReturnType<typeof setTimeout> | null;
  poller: ReturnType<typeof setInterval> | null;
  polling: boolean;
};

type LiveStore = {
  entries: Map<string, StreamEntry>;
  seen: Set<string>;
  seenQueue: string[];
  processing: Set<string>;
  misses: Map<string, number>;
};

const globalLiveStore = globalThis as typeof globalThis & {
  __cmxLiveStore?: LiveStore;
};

const store = globalLiveStore.__cmxLiveStore ?? {
  entries: new Map<string, StreamEntry>(),
  seen: new Set<string>(),
  seenQueue: [],
  processing: new Set<string>(),
  misses: new Map<string, number>(),
};

globalLiveStore.__cmxLiveStore = store;
store.processing ??= new Set<string>();
store.misses ??= new Map<string, number>();

function remember(signature: string) {
  if (store.seen.has(signature)) return false;
  store.seen.add(signature);
  store.seenQueue.push(signature);
  while (store.seenQueue.length > 2_000) {
    const oldest = store.seenQueue.shift();
    if (oldest) store.seen.delete(oldest);
  }
  return true;
}

async function publishSignature(address: string, entry: StreamEntry, signature: string, market: DbcMarket) {
  if (store.seen.has(signature) || store.processing.has(signature)) return;
  store.processing.add(signature);
  try {
    const trade = await getMarketTrade(address, signature, market);
    if (!trade) {
      const misses = (store.misses.get(signature) ?? 0) + 1;
      if (misses >= 3) {
        store.misses.delete(signature);
        remember(signature);
      } else {
        store.misses.set(signature, misses);
      }
      return;
    }
    store.misses.delete(signature);
    remember(signature);
    for (const listener of entry.listeners) listener(trade);
  } catch {
    // Leave this signature retryable. Public devnet RPCs can throttle the
    // transaction read even after the confirmation notification arrives.
  } finally {
    store.processing.delete(signature);
  }
}

async function reconcile(address: string, entry: StreamEntry, market: DbcMarket) {
  if (entry.polling || !entry.listeners.size) return;
  entry.polling = true;
  try {
    const connection = await getMarketRpcConnection(market.cluster);
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(address),
      { limit: 12 },
      "confirmed",
    );
    await Promise.all(
      [...signatures]
        .reverse()
        .filter((item) => !item.err)
        .map((item) => publishSignature(address, entry, item.signature, market)),
    );
  } catch {
    // WebSocket delivery remains primary; the next reconciliation tick retries
    // transient HTTP RPC failures without closing client streams.
  } finally {
    entry.polling = false;
  }
}

async function start(address: string, entry: StreamEntry, market: DbcMarket) {
  if (entry.poller || entry.subscriptionId !== null || entry.starting) return;
  const connection = await getMarketRpcConnection(market.cluster);
  entry.poller = setInterval(() => void reconcile(address, entry, market), 3_000);
  void reconcile(address, entry, market);

  // Public devnet WebSockets frequently reject subscriptions with 429 and then
  // reconnect indefinitely. Use the polling path unless a provider WSS URL is
  // explicitly configured; production still gets low-latency log delivery.
  const wsConfigured = market.cluster === "devnet"
    ? process.env.SOLANA_DEVNET_WSS_URL || process.env.SOLANA_WSS_URL
    : process.env.SOLANA_MAINNET_WSS_URL;
  if (!wsConfigured) return;
  try {
    const subscriptionId = connection.onLogs(
      new PublicKey(address),
      (notification) => {
        if (notification.err) return;
        void publishSignature(address, entry, notification.signature, market);
      },
      "confirmed",
    );
    entry.subscriptionId = subscriptionId;
  } catch {
    // The reconciliation poll remains active and truthful without WebSocket.
  }
}

async function stop(address: string, entry: StreamEntry, market: DbcMarket) {
  if (entry.listeners.size) return;
  if (entry.poller) {
    clearInterval(entry.poller);
    entry.poller = null;
  }
  const subscriptionId = entry.subscriptionId;
  entry.subscriptionId = null;
  if (subscriptionId !== null) {
    const connection = await getMarketRpcConnection(market.cluster);
    await connection.removeOnLogsListener(subscriptionId).catch(() => undefined);
  }
  if (!entry.listeners.size) store.entries.delete(address);
}

export function subscribeMarketTrades(market: DbcMarket, listener: TradeListener) {
  const normalized = new PublicKey(
    market.migrated && market.graduatedPool ? market.graduatedPool : market.address,
  ).toBase58();
  const key = `${market.cluster}:${normalized}`;
  let entry = store.entries.get(key);
  if (!entry) {
    entry = {
      listeners: new Set(),
      subscriptionId: null,
      starting: null,
      teardown: null,
      poller: null,
      polling: false,
    };
    store.entries.set(key, entry);
  }
  if (entry.teardown) {
    clearTimeout(entry.teardown);
    entry.teardown = null;
  }
  entry.listeners.add(listener);
  const ready = start(normalized, entry, market);

  return {
    ready,
    unsubscribe: () => {
      entry?.listeners.delete(listener);
      if (!entry || entry.listeners.size) return;
      entry.teardown = setTimeout(() => {
        entry!.teardown = null;
        void stop(key, entry!, market);
      }, 10_000);
    },
  };
}
