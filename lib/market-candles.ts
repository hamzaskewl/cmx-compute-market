import type {
  CandleIntervalSeconds,
  MarketCandle,
  MarketPricePoint,
} from "@/lib/market-types";

export const CANDLE_INTERVALS: readonly CandleIntervalSeconds[] = [1, 3, 5, 60];

export function isCandleInterval(value: number): value is CandleIntervalSeconds {
  return CANDLE_INTERVALS.includes(value as CandleIntervalSeconds);
}

export function buildMarketCandles(
  points: readonly MarketPricePoint[],
  intervalSeconds: CandleIntervalSeconds,
) {
  const bucketMilliseconds = intervalSeconds * 1000;
  const candles = new Map<number, MarketCandle>();
  const ordered = [...points].sort((left, right) => left.timestamp - right.timestamp);
  let previousClose: number | null = null;

  for (const point of ordered) {
    if (!Number.isFinite(point.timestamp)
      || !Number.isFinite(point.priceInPair)
      || !Number.isFinite(point.volumeQuote)
      || point.priceInPair <= 0
      || point.volumeQuote < 0) continue;

    const timestamp = Math.floor(point.timestamp / bucketMilliseconds) * bucketMilliseconds;
    const existing = candles.get(timestamp);
    if (!existing) {
      // The DBC curve keeps its last executed price between swaps. Carrying
      // that confirmed close into the next active bucket makes the curve move
      // visible in sparse markets without inventing a trade or any volume.
      const open = previousClose ?? point.priceInPair;
      candles.set(timestamp, {
        timestamp,
        open,
        high: Math.max(open, point.priceInPair),
        low: Math.min(open, point.priceInPair),
        close: point.priceInPair,
        volumeQuote: point.volumeQuote,
        buyVolumeQuote: point.side === "buy" ? point.volumeQuote : 0,
        sellVolumeQuote: point.side === "sell" ? point.volumeQuote : 0,
        tradeCount: 1,
      });
      previousClose = point.priceInPair;
      continue;
    }

    existing.high = Math.max(existing.high, point.priceInPair);
    existing.low = Math.min(existing.low, point.priceInPair);
    existing.close = point.priceInPair;
    existing.volumeQuote += point.volumeQuote;
    existing.buyVolumeQuote += point.side === "buy" ? point.volumeQuote : 0;
    existing.sellVolumeQuote += point.side === "sell" ? point.volumeQuote : 0;
    existing.tradeCount += 1;
    previousClose = point.priceInPair;
  }

  return [...candles.values()];
}
