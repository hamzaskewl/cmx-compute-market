"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketChart } from "@/components/market-chart";
import {
  connectWallet,
  dbcMarketBalances,
  loadDbcMarket,
  loadDeployment,
  migrateDbcMarket,
  tradeDbcMarket,
  type DbcMarket,
  type Deployment,
} from "@/lib/chain-client";
import type { MarketTrade } from "@/lib/market-types";
import styles from "@/app/market.module.css";

function short(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function formatPrice(value: number) {
  return value >= 0.01 ? value.toFixed(4) : value.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

function formatUsd(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 0.01 ? 8 : 2,
  });
}

function b200Usd(amount: number, referencePrice: number | null) {
  return referencePrice === null ? "USD unavailable" : formatUsd(amount * referencePrice);
}

function graduationLabel(progress: number, migrated: boolean, migrationReady: boolean) {
  if (migrated) return "Graduated";
  if (migrationReady) return "Ready to migrate";
  if (progress >= 99.99) {
    const truncated = Math.floor(Math.min(progress, 99.9999) * 10_000) / 10_000;
    return `${truncated.toFixed(4)}%`;
  }
  return `${progress.toFixed(2)}%`;
}

function safeWebsite(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function withTrades(market: DbcMarket, candidates: MarketTrade[]) {
  const bySignature = new Map<string, MarketTrade>();
  for (const trade of candidates) bySignature.set(trade.signature, trade);
  const trades = [...bySignature.values()]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 1_000);
  const chronological = [...trades].reverse();
  const history = chronological.map((trade) => ({
    timestamp: trade.timestamp,
    priceInPair: trade.priceInPair,
    volumeQuote: trade.quoteAmount,
    side: trade.side,
  }));
  const firstPrice = history[0]?.priceInPair;
  const lastPrice = history.at(-1)?.priceInPair;
  return {
    ...market,
    changePercent: firstPrice && lastPrice && history.length > 1
      ? ((lastPrice - firstPrice) / firstPrice) * 100
      : null,
    history,
    lastTradeAt: chronological.at(-1)?.timestamp ?? null,
    tradeCount: trades.length,
    trades,
    volumeQuote: trades.reduce((total, trade) => total + trade.quoteAmount, 0),
  };
}

function mergeMarketSnapshot(current: DbcMarket, snapshot: DbcMarket) {
  return withTrades(
    {
      ...current,
      ...snapshot,
      createdAt: snapshot.createdAt ?? current.createdAt,
    },
    [...snapshot.trades, ...current.trades],
  );
}

function BrandMark() {
  return (
    <svg aria-hidden="true" className={styles.brandMark} viewBox="0 0 28 28">
      <path d="M20.75 7.25A9.5 9.5 0 1 0 20.75 20.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
      <path d="m18.25 9.5 4.75 4.5-4.75 4.5" fill="none" stroke="#8e95ff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
    </svg>
  );
}

function mergeLiveTrade(market: DbcMarket, trade: MarketTrade): DbcMarket {
  if (market.trades.some((item) => item.signature === trade.signature)) return market;
  return withTrades(market, [trade, ...market.trades]);
}

export function MarketTerminal({ initialMarket, b200ReferencePrice }: {
  initialMarket: DbcMarket;
  b200ReferencePrice: number | null;
}) {
  const [market, setMarket] = useState(initialMarket);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [balances, setBalances] = useState({ b200: 0, token: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Connect Phantom to trade.");
  const [signature, setSignature] = useState<string | null>(null);
  const [partialFill, setPartialFill] = useState<{ spent: number; unspent: number } | null>(null);
  const [lastLiveSignature, setLastLiveSignature] = useState<string | null>(null);
  const [chartSource, setChartSource] = useState<"official" | "gmgn">("official");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadDeployment().then(setDeployment).catch(() => setMessage("The market deployment is temporarily unavailable."));
  }, []);

  const refreshMarket = useCallback(async (expectedSignature?: string) => {
    let latest: DbcMarket | null = null;
    const attempts = expectedSignature ? 6 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await loadDbcMarket(market.address, true);
      latest = result.market;
      setMarket((current) => mergeMarketSnapshot(current, result.market));
      if (!expectedSignature || result.market.trades.some((trade) => trade.signature === expectedSignature)) break;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
    if (deployment && wallet && latest) setBalances(await dbcMarketBalances(deployment, latest));
    return !expectedSignature || Boolean(latest?.trades.some((trade) => trade.signature === expectedSignature));
  }, [deployment, market.address, wallet]);

  useEffect(() => {
    const source = new EventSource(`/api/markets/${market.address}/stream`);
    source.addEventListener("snapshot", (event) => {
      const snapshot = JSON.parse((event as MessageEvent<string>).data) as DbcMarket;
      setMarket((current) => mergeMarketSnapshot(current, snapshot));
    });
    source.addEventListener("trade", (event) => {
      const trade = JSON.parse((event as MessageEvent<string>).data) as MarketTrade;
      setLastLiveSignature(trade.signature);
      setMarket((current) => mergeLiveTrade(current, trade));
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        void refreshMarket(trade.signature).catch(() => undefined);
      }, 1_200);
    });
    return () => {
      source.close();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [market.address, refreshMarket]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setSignature(null);
    setPartialFill(null);
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request did not complete.");
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = () => run("connect", async () => {
    const publicKey = await connectWallet();
    if (!deployment) throw new Error("The market deployment is still loading.");
    setWallet(publicKey.toBase58());
    setBalances(await dbcMarketBalances(deployment, market));
    setMessage("Wallet connected.");
  });

  const handleTrade = () => run("trade", async () => {
    if (!deployment || !wallet) throw new Error("Connect Phantom before trading.");
    const result = await tradeDbcMarket(deployment, market, mode, Number(amount));
    setSignature(result.signature);
    const indexed = await refreshMarket(result.signature);
    const output = result.estimatedOut.toLocaleString(undefined, { maximumFractionDigits: 6 });
    if (!indexed) {
      setMessage("Trade settled. Market data is still syncing.");
      return;
    }
    if (mode === "buy" && result.unusedInput > 0) {
      setPartialFill({ spent: result.actualInput, unspent: result.unusedInput });
      setMessage(`Final buy partially filled at the curve boundary. Received approximately ${output} tokens.`);
    } else {
      setMessage(`${mode === "buy" ? "Buy" : "Sell"} complete. Received approximately ${output}.`);
    }
  });

  const handleMigration = () => run("migrate", async () => {
    if (!deployment || !wallet) throw new Error("Connect Phantom before migrating this market.");
    const result = await migrateDbcMarket(deployment, market);
    setSignature(result.signature);
    await refreshMarket();
    setMessage("Migration complete. Liquidity is now active on DAMM v2.");
  });

  const website = safeWebsite(market.website);
  const usdPrice = b200ReferencePrice ? market.priceInPair * b200ReferencePrice : null;
  const latest = market.trades[0];
  const change = market.changePercent;
  const progress = Math.min(100, Math.max(0, market.progressPercent));
  const createdLabel = market.createdAt ? new Date(market.createdAt).toLocaleString() : "Unresolved";
  const status = market.migrated
    ? "DAMM v2"
    : market.migrationReady
      ? "Migration ready"
      : "Bonding curve";
  const isMainnet = market.cluster === "mainnet-beta";
  const explorerCluster = isMainnet ? "" : "?cluster=devnet";
  const graduatedPoolUrl = market.graduatedPool
    ? `https://explorer.solana.com/address/${market.graduatedPool}${explorerCluster}`
    : null;
  const gmgnChartUrl = `https://www.gmgn.cc/kline/sol/${market.mint}?theme=dark&interval=1S`;

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <Link className={styles.brand} href="/"><BrandMark /><span>Compute Market</span></Link>
        <div className={styles.marketCrumb}><span>Markets</span><span>/</span><strong>{market.name}</strong></div>
        <button className={styles.walletButton} disabled={busy === "connect"} onClick={handleConnect} type="button">
          {wallet ? short(wallet) : busy === "connect" ? "Connecting…" : "Connect Phantom"}
        </button>
      </header>

      <section className={styles.identityStrip}>
        <div className={styles.tokenIdentity}>
          {market.logo ? (
            <Image alt={`${market.name} logo`} className={styles.tokenLogo} height={58} onError={(event) => { event.currentTarget.src = "/favicon.svg"; }} referrerPolicy="no-referrer" src={market.logo} unoptimized width={58} />
          ) : <span className={styles.tokenGlyph}>{market.name.slice(0, 2).toUpperCase()}</span>}
          <div><h1>{market.name}</h1><p>{short(market.mint)} / cmB200</p></div>
        </div>
        <div className={styles.primaryQuote}>
          <span>Curve price</span>
          <strong>{formatPrice(market.priceInPair)} cmB200</strong>
          <small>{usdPrice === null ? "USD unavailable" : `≈ ${formatUsd(usdPrice)}`}</small>
        </div>
        <div className={styles.identityMetric}><span>Volume</span><strong>{market.volumeQuote.toFixed(6)} cmB200</strong><small>{b200Usd(market.volumeQuote, b200ReferencePrice)} · {market.tradeCount} swaps</small></div>
        <div className={styles.identityMetric}><span>History change</span><strong className={change !== null && change < 0 ? styles.negative : styles.positive}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</strong><small>First to latest indexed swap</small></div>
        <div className={styles.identityMetric}><span>Market</span><strong>{status}</strong><small>{market.migrated ? "Liquidity pool" : market.migrationReady ? "Ready for DAMM v2" : "Trading"}</small></div>
      </section>

      <section className={styles.terminalGrid}>
        <div className={styles.marketMain}>
          <nav aria-label="Chart data source" className={styles.chartSourceBar}>
            <div className={styles.chartSourceTabs}>
              <button aria-pressed={chartSource === "official"} onClick={() => setChartSource("official")} type="button">
              CMX <span>Official</span>
              </button>
              <button
                aria-pressed={chartSource === "gmgn"}
                disabled={!isMainnet}
                onClick={() => setChartSource("gmgn")}
                title={isMainnet ? "View the GMGN indexed chart" : "GMGN indexes mainnet tokens; this market is on devnet"}
                type="button"
              >
                GMGN <span>{isMainnet ? "Indexed" : "Mainnet"}</span>
              </button>
            </div>
            <p>{chartSource === "official"
              ? "Market trades"
              : "Independent mainnet index by GMGN"}</p>
          </nav>

          {chartSource === "gmgn" && isMainnet ? (
            <section aria-label="GMGN indexed price chart" className={styles.gmgnPanel}>
              <iframe
                allow="clipboard-write"
                className={styles.gmgnFrame}
                loading="eager"
                referrerPolicy="strict-origin-when-cross-origin"
                src={gmgnChartUrl}
                title={`${market.name} price chart by GMGN`}
              />
              <div className={styles.chartFooter}>
                <span>Third-party indexed mainnet view · availability controlled by GMGN</span>
                <a href={gmgnChartUrl} rel="noreferrer" target="_blank">Open GMGN chart ↗</a>
              </div>
            </section>
          ) : (
            <MarketChart b200ReferencePrice={b200ReferencePrice} currentPrice={market.priceInPair} history={market.history} />
          )}

          <section className={styles.tapePanel}>
            <div className={styles.sectionHeader}>
              <div><h2>Trades</h2><p>New swaps appear automatically.</p></div>
              <button disabled={busy !== null} onClick={() => void run("refresh", async () => { await refreshMarket(); })} type="button">{busy === "refresh" ? "Refreshing…" : "Refresh"}</button>
            </div>
            {market.trades.length ? (
              <div aria-live="polite" className={styles.tradeTable}>
                <div aria-hidden="true" className={styles.tradeHead}><span>Time</span><span>Side</span><span>Price</span><span>Token amount</span><span>B200 amount</span><span>Transaction</span></div>
                {market.trades.map((trade) => (
                  <div className={`${styles.tradeRow} ${trade.signature === lastLiveSignature ? styles.tradeRowLive : ""}`} key={trade.signature}>
                    <span>{new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <strong className={trade.side === "buy" ? styles.positive : styles.negative}>{trade.side.toUpperCase()}</strong>
                    <span className={styles.b200Cell}>{formatPrice(trade.priceInPair)}<small>{b200Usd(trade.priceInPair, b200ReferencePrice)}</small></span>
                    <span>{trade.baseAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                    <span className={styles.b200Cell}>{trade.quoteAmount.toFixed(6)}<small>{b200Usd(trade.quoteAmount, b200ReferencePrice)}</small></span>
                    <a href={`https://explorer.solana.com/tx/${trade.signature}${explorerCluster}`} rel="noreferrer" target="_blank">{short(trade.signature)} ↗</a>
                  </div>
                ))}
              </div>
            ) : <div className={styles.tapeEmpty}>No swaps yet.</div>}
          </section>

          <section className={styles.detailPanel}>
            <div className={styles.sectionHeader}><div><h2>Market registry</h2><p>Pool identifiers and public launch metadata.</p></div></div>
            <dl className={styles.detailGrid}>
              <div><dt>Pool</dt><dd><a href={`https://explorer.solana.com/address/${market.address}${explorerCluster}`} rel="noreferrer" target="_blank">{short(market.address)} ↗</a></dd></div>
              <div><dt>Token mint</dt><dd><a href={`https://explorer.solana.com/address/${market.mint}${explorerCluster}`} rel="noreferrer" target="_blank">{short(market.mint)} ↗</a></dd></div>
              <div><dt>Creator</dt><dd><a href={`https://explorer.solana.com/address/${market.creator}${explorerCluster}`} rel="noreferrer" target="_blank">{short(market.creator)} ↗</a></dd></div>
              <div><dt>Created</dt><dd>{createdLabel}</dd></div>
              <div><dt>Trading fee</dt><dd>{market.feePercent.toFixed(2)}%</dd></div>
              <div><dt>Quote reserve</dt><dd className={styles.stackedValue}><span>{market.quoteReserve.toFixed(6)} cmB200</span><small>{b200Usd(market.quoteReserve, b200ReferencePrice)}</small></dd></div>
              <div><dt>Website</dt><dd>{website ? <a href={website} rel="nofollow noreferrer" target="_blank">Visit ↗</a> : "Not provided"}</dd></div>
              <div><dt>Indexing</dt><dd>{market.dexScreenerUrl
                ? <a href={market.dexScreenerUrl} rel="noreferrer" target="_blank">Open DexScreener ↗</a>
                : market.migrated && graduatedPoolUrl
                  ? <a href={graduatedPoolUrl} rel="noreferrer" target="_blank">Open DAMM v2 pool ↗</a>
                  : "DexScreener after graduation"}</dd></div>
            </dl>
          </section>
        </div>

        <aside className={styles.tradeRail}>
          <div className={styles.railState}><strong>{status}</strong><small>{latest ? `Last swap ${new Date(latest.timestamp).toLocaleTimeString()}` : "No swaps yet"}</small></div>
          <div className={styles.tradeTabs}>
            <button aria-pressed={mode === "buy"} disabled={market.migrationReady || market.migrated} onClick={() => setMode("buy")} type="button">Buy</button>
            <button aria-pressed={mode === "sell"} disabled={market.migrationReady || market.migrated} onClick={() => setMode("sell")} type="button">Sell</button>
          </div>
          <div className={styles.balanceGrid}>
            <span>cmB200 <strong>{wallet ? balances.b200.toFixed(4) : "—"}</strong><small>{wallet ? b200Usd(balances.b200, b200ReferencePrice) : "—"}</small></span>
            <span>Token <strong>{wallet ? balances.token.toFixed(4) : "—"}</strong></span>
          </div>
          <label className={styles.amountField}>
            <span>{mode === "buy" ? "cmB200 in" : "Launch token in"}</span>
            <input disabled={market.migrationReady || market.migrated} inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} step="any" type="number" value={amount} />
            {mode === "buy" && Number(amount) > 0 && <small>{b200Usd(Number(amount), b200ReferencePrice)}</small>}
          </label>
          <div className={styles.quotePreview}>
            <span>Current curve</span><strong>{formatPrice(market.priceInPair)} cmB200</strong>
            <small>{b200Usd(market.priceInPair, b200ReferencePrice)}</small>
            {!market.migrationReady && !market.migrated && <small>1% maximum slippage. A final buy can partially fill at the curve boundary; unspent cmB200 stays in your wallet.</small>}
          </div>
          {market.migrated && graduatedPoolUrl ? (
            <a className={styles.tradeButtonLink} href={market.dexScreenerUrl ?? graduatedPoolUrl} rel="noreferrer" target="_blank">Open DAMM v2 market ↗</a>
          ) : market.migrationReady ? (
            <button className={styles.tradeButton} disabled={busy !== null || !wallet} onClick={handleMigration} type="button">
              {!wallet ? "Connect wallet to migrate" : busy === "migrate" ? "Migrating…" : "Migrate to DAMM v2"}
            </button>
          ) : (
            <button className={styles.tradeButton} disabled={busy !== null || !wallet} onClick={handleTrade} type="button">
              {!wallet ? "Connect wallet to trade" : busy === "trade" ? "Submitting…" : `${mode === "buy" ? "Buy" : "Sell"}`}
            </button>
          )}
          {(message || signature) && <div aria-live="polite" className={styles.tradeStatus}>
            <p>{message}</p>
            {partialFill && <div className={styles.partialFillReceipt}>
              <span><i>Spent</i><strong>{partialFill.spent.toFixed(6)} cmB200</strong><small>{b200Usd(partialFill.spent, b200ReferencePrice)}</small></span>
              <span><i>Unspent</i><strong>{partialFill.unspent.toFixed(6)} cmB200</strong><small>{b200Usd(partialFill.unspent, b200ReferencePrice)}</small></span>
            </div>}
            {signature && <a href={`https://explorer.solana.com/tx/${signature}${explorerCluster}`} rel="noreferrer" target="_blank">View transaction ↗</a>}
          </div>}
          <div className={styles.graduationBlock}>
            <div><span>Bonding curve</span><strong>{graduationLabel(progress, market.migrated, market.migrationReady)}</strong></div>
            <div className={styles.progressTrack}><span style={{ width: `${progress}%` }} /></div>
            <p><span>{market.quoteReserve.toFixed(6)} cmB200</span><small>{b200Usd(market.quoteReserve, b200ReferencePrice)}</small>{market.migrated
              ? "Liquidity is active on DAMM v2."
              : market.migrationReady
                ? "The curve is complete and ready to migrate."
                : "The final buy may partially fill. Once the curve completes, liquidity can migrate to DAMM v2."}</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
