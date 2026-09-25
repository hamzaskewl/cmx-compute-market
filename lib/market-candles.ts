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

    // Small swaps are rounded to the quote mint's six decimals. Keep their
    // volume, but do not turn the rounded transfer ratio into a false candle.
    if (point.priceReliable === false && previousClose === null) continue;
    const price: number = point.priceReliable === false ? previousClose! : point.priceInPair;

    const timestamp = Math.floor(point.timestamp / bucketMilliseconds) * bucketMilliseconds;
    const existing = candles.get(timestamp);
    if (!existing) {
      // The DBC curve keeps its last executed price between swaps. Carrying
      // that confirmed close into the next active bucket makes the curve move
      // visible in sparse markets without inventing a trade or any volume.
      const open = previousClose ?? price;
      candles.set(timestamp, {
        timestamp,
        open,
        high: Math.max(open, price),
        low: Math.min(open, price),
        close: price,
        volumeQuote: point.volumeQuote,
        buyVolumeQuote: point.side === "buy" ? point.volumeQuote : 0,
        sellVolumeQuote: point.side === "sell" ? point.volumeQuote : 0,
        tradeCount: 1,
      });
      previousClose = price;
      continue;
    }

    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
    existing.volumeQuote += point.volumeQuote;
    existing.buyVolumeQuote += point.side === "buy" ? point.volumeQuote : 0;
    existing.sellVolumeQuote += point.side === "sell" ? point.volumeQuote : 0;
    existing.tradeCount += 1;
    previousClose = price;
  }

  return [...candles.values()];
}
