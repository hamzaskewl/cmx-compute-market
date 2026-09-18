"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LastPriceAnimationMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { buildMarketCandles } from "@/lib/market-candles";
import type {
  CandleIntervalSeconds,
  MarketCandle,
  MarketPricePoint,
} from "@/lib/market-types";
import styles from "@/app/market.module.css";

type ChartStyle = "candles" | "line";

const intervals: Array<{ label: string; value: CandleIntervalSeconds }> = [
  { label: "1s", value: 1 },
  { label: "3s", value: 3 },
  { label: "5s", value: 5 },
  { label: "1m", value: 60 },
];

function formatPrice(value: number) {
  return value >= 0.01
    ? value.toFixed(4)
    : value.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

function toTime(timestamp: number) {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

function candleData(candles: readonly MarketCandle[]) {
  return candles.map((candle) => ({
    time: toTime(candle.timestamp),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function lineData(candles: readonly MarketCandle[]) {
  return candles.map((candle) => ({ time: toTime(candle.timestamp), value: candle.close }));
}

function volumeData(candles: readonly MarketCandle[]) {
  return candles.map((candle) => ({
    time: toTime(candle.timestamp),
    value: candle.volumeQuote,
    color: candle.close >= candle.open ? "#47705d" : "#754c52",
  }));
}

function latestLabel(candle: MarketCandle | null) {
  if (!candle) return "No trades yet";
  return `${candle.tradeCount} trade${candle.tradeCount === 1 ? "" : "s"}`;
}

function usdValue(amount: number, referencePrice: number | null) {
  if (referencePrice === null) return "USD unavailable";
  const value = amount * referencePrice;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 0.01 ? 8 : 2,
  });
}

export function MarketChart({
  b200ReferencePrice,
  history,
  currentPrice,
}: {
  b200ReferencePrice: number | null;
  history: MarketPricePoint[];
  currentPrice: number;
}) {
  const [interval, setIntervalValue] = useState<CandleIntervalSeconds>(1);
  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles");
  const [inspectedCandle, setInspectedCandle] = useState<MarketCandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const curveLineRef = useRef<IPriceLine | null>(null);
  const candlesRef = useRef<MarketCandle[]>([]);
  const currentPriceRef = useRef(currentPrice);
  const appliedRef = useRef<{ count: number; lastTime: number } | null>(null);

  const candles = useMemo(
    () => buildMarketCandles(history, interval),
    [history, interval],
  );
  const activeCandle = inspectedCandle ?? candles.at(-1) ?? null;
  const hasData = candles.length > 0;

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);

  useEffect(() => {
    if (!containerRef.current || !hasData) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        attributionLogo: true,
        background: { color: "#192428", type: ColorType.Solid },
        fontFamily: "var(--type-data), monospace",
        textColor: "#8f9aa7",
      },
      grid: {
        horzLines: { color: "#2f3d43", style: LineStyle.Dotted },
        vertLines: { color: "#27353b", style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { color: "#7c8890", labelBackgroundColor: "#536169", style: LineStyle.Dashed },
        vertLine: { color: "#7c8890", labelBackgroundColor: "#536169", style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: "#435159",
        scaleMargins: { bottom: 0.24, top: 0.1 },
      },
      timeScale: {
        borderColor: "#435159",
        rightOffset: 5,
        secondsVisible: interval < 60,
        timeVisible: true,
      },
      localization: { priceFormatter: formatPrice },
    });

    let candleSeries: ISeriesApi<"Candlestick"> | null = null;
    let lineSeries: ISeriesApi<"Line"> | null = null;
    if (chartStyle === "candles") {
      candleSeries = chart.addSeries(CandlestickSeries, {
        borderDownColor: "#ef777f",
        borderUpColor: "#83d6a1",
        downColor: "#d95f69",
        priceFormat: { minMove: 0.0000000001, precision: 10, type: "price" },
        priceLineVisible: false,
        upColor: "#74c993",
        wickDownColor: "#ef777f",
        wickUpColor: "#83d6a1",
      });
      candleSeries.setData(candleData(candlesRef.current));
      candleSeriesRef.current = candleSeries;
    } else {
      lineSeries = chart.addSeries(LineSeries, {
        color: "#9ba2ff",
        lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
        lineWidth: 2,
        priceFormat: { minMove: 0.0000000001, precision: 10, type: "price" },
        priceLineVisible: false,
      });
      lineSeries.setData(lineData(candlesRef.current));
      lineSeriesRef.current = lineSeries;
    }

    const priceSeries = candleSeries ?? lineSeries!;
    const curveLine = priceSeries.createPriceLine({
      axisLabelVisible: true,
      color: "#8e95d8",
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      price: currentPriceRef.current,
      title: "CURVE",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#41525a",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { bottom: 0, top: 0.82 } });
    volumeSeries.setData(volumeData(candlesRef.current));

    chart.subscribeCrosshairMove((parameter) => {
      if (typeof parameter.time !== "number") {
        setInspectedCandle(null);
        return;
      }
      const timestamp = Number(parameter.time) * 1000;
      setInspectedCandle(candlesRef.current.find((candle) => candle.timestamp === timestamp) ?? null);
    });
    chart.timeScale().fitContent();
    chartRef.current = chart;
    volumeSeriesRef.current = volumeSeries;
    curveLineRef.current = curveLine;
    const last = candlesRef.current.at(-1);
    appliedRef.current = { count: candlesRef.current.length, lastTime: last?.timestamp ?? 0 };

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      curveLineRef.current = null;
      appliedRef.current = null;
    };
  }, [chartStyle, hasData, interval]);

  useEffect(() => {
    if (!hasData || !chartRef.current) return;
    const last = candles.at(-1)!;
    const applied = appliedRef.current;
    const canIncrement = applied
      && candles.length >= applied.count
      && candles.length <= applied.count + 1
      && last.timestamp >= applied.lastTime;

    if (canIncrement) {
      candleSeriesRef.current?.update(candleData([last])[0]);
      lineSeriesRef.current?.update(lineData([last])[0]);
      volumeSeriesRef.current?.update(volumeData([last])[0]);
    } else {
      candleSeriesRef.current?.setData(candleData(candles));
      lineSeriesRef.current?.setData(lineData(candles));
      volumeSeriesRef.current?.setData(volumeData(candles));
    }
    appliedRef.current = { count: candles.length, lastTime: last.timestamp };
  }, [candles, hasData]);

  useEffect(() => {
    curveLineRef.current?.applyOptions({ price: currentPrice });
  }, [currentPrice]);

  return (
    <section aria-labelledby="price-chart-title" className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitleBlock}>
          <div className={styles.chartTitleLine}>
            <span id="price-chart-title">Market chart</span>
          </div>
          <small>cmB200 per token · market trades · curve shown dashed</small>
        </div>
        <div className={styles.chartToolbar}>
          <div aria-label="Candle interval" className={styles.rangeSwitch}>
            {intervals.map((item) => (
              <button aria-pressed={interval === item.value} key={item.value} onClick={() => setIntervalValue(item.value)} type="button">
                {item.label}
              </button>
            ))}
          </div>
          <div aria-label="Chart style" className={styles.styleSwitch}>
            <button aria-pressed={chartStyle === "candles"} onClick={() => setChartStyle("candles")} type="button">Candles</button>
            <button aria-pressed={chartStyle === "line"} onClick={() => setChartStyle("line")} type="button">Line</button>
          </div>
        </div>
      </div>
      {hasData ? (
        <>
          <div className={styles.ohlcStrip}>
            <span className={styles.ohlcValue}>O <strong>{formatPrice(activeCandle!.open)}</strong><i>{usdValue(activeCandle!.open, b200ReferencePrice)}</i></span>
            <span className={styles.ohlcValue}>H <strong>{formatPrice(activeCandle!.high)}</strong><i>{usdValue(activeCandle!.high, b200ReferencePrice)}</i></span>
            <span className={styles.ohlcValue}>L <strong>{formatPrice(activeCandle!.low)}</strong><i>{usdValue(activeCandle!.low, b200ReferencePrice)}</i></span>
            <span className={styles.ohlcValue}>C <strong className={activeCandle!.close >= activeCandle!.open ? styles.positive : styles.negative}>{formatPrice(activeCandle!.close)}</strong><i>{usdValue(activeCandle!.close, b200ReferencePrice)}</i></span>
            <span className={styles.ohlcValue}>VOL <strong>{activeCandle!.volumeQuote.toFixed(6)}</strong><i>{usdValue(activeCandle!.volumeQuote, b200ReferencePrice)}</i></span>
            <small className={styles.ohlcSummary}>{latestLabel(activeCandle)}</small>
          </div>
          <div className={styles.liveChartCanvas} ref={containerRef} />
          <div className={styles.chartFooter}>
            <span>{interval}s OHLC · market trades</span>
            <a href="https://www.tradingview.com/lightweight-charts/" rel="noreferrer" target="_blank">Charts by TradingView</a>
          </div>
        </>
      ) : (
        <div className={styles.chartEmpty}>
          <strong>No trades yet.</strong>
          <span className={styles.chartEmptyPrice}><b>{formatPrice(currentPrice)} cmB200</b><small>{usdValue(currentPrice, b200ReferencePrice)}</small></span>
          <span>The first trade will start the chart.</span>
        </div>
      )}
    </section>
  );
}
