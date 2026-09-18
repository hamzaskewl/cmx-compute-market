import { PublicKey } from "@solana/web3.js";
import { getMarketRpcConnection, getMarketTrade } from "@/lib/dbc-markets";
import type { MarketTrade } from "@/lib/market-types";

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

async function publishSignature(address: string, entry: StreamEntry, signature: string) {
  if (store.seen.has(signature) || store.processing.has(signature)) return;
  store.processing.add(signature);
  try {
    const trade = await getMarketTrade(address, signature);
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

async function reconcile(address: string, entry: StreamEntry) {
  if (entry.polling || !entry.listeners.size) return;
  entry.polling = true;
  try {
    const connection = await getMarketRpcConnection();
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(address),
      { limit: 12 },
      "confirmed",
    );
    await Promise.all(
      [...signatures]
        .reverse()
        .filter((item) => !item.err)
        .map((item) => publishSignature(address, entry, item.signature)),
    );
  } catch {
    // WebSocket delivery remains primary; the next reconciliation tick retries
    // transient HTTP RPC failures without closing client streams.
  } finally {
    entry.polling = false;
  }
}

async function start(address: string, entry: StreamEntry) {
  if (entry.poller || entry.subscriptionId !== null || entry.starting) return;
  const connection = await getMarketRpcConnection();
  entry.poller = setInterval(() => void reconcile(address, entry), 3_000);
  void reconcile(address, entry);

  // Polling is a fully independent confirmed-chain fallback, so clients do not
  // stay stuck in "connecting" when a public WebSocket endpoint returns 429.
  try {
    const subscriptionId = connection.onLogs(
      new PublicKey(address),
      (notification) => {
        if (notification.err) return;
        void publishSignature(address, entry, notification.signature);
      },
      "confirmed",
    );
    entry.subscriptionId = subscriptionId;
  } catch {
    // The reconciliation poll remains active and truthful without WebSocket.
  }
}

async function stop(address: string, entry: StreamEntry) {
  if (entry.listeners.size) return;
  if (entry.poller) {
    clearInterval(entry.poller);
    entry.poller = null;
  }
  const subscriptionId = entry.subscriptionId;
  entry.subscriptionId = null;
  if (subscriptionId !== null) {
    const connection = await getMarketRpcConnection();
    await connection.removeOnLogsListener(subscriptionId).catch(() => undefined);
  }
  if (!entry.listeners.size) store.entries.delete(address);
}

export function subscribeMarketTrades(address: string, listener: TradeListener) {
  const normalized = new PublicKey(address).toBase58();
  let entry = store.entries.get(normalized);
  if (!entry) {
    entry = {
      listeners: new Set(),
      subscriptionId: null,
      starting: null,
      teardown: null,
      poller: null,
      polling: false,
    };
    store.entries.set(normalized, entry);
  }
  if (entry.teardown) {
    clearTimeout(entry.teardown);
    entry.teardown = null;
  }
  entry.listeners.add(listener);
  const ready = start(normalized, entry);

  return {
    ready,
    unsubscribe: () => {
      entry?.listeners.delete(listener);
      if (!entry || entry.listeners.size) return;
      entry.teardown = setTimeout(() => {
        entry!.teardown = null;
        void stop(normalized, entry!);
      }, 10_000);
    },
  };
}
