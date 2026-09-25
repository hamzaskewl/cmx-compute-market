"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketChart } from "@/components/market-chart";
import { SiteHeader } from "@/components/site-header";
import { useWallet } from "@/components/wallet-context";
import {
  dbcMarketBalances,
  loadDbcMarket,
  loadDeployment,
  migrateDbcMarket,
  tradeDammMarket,
  tradeDbcMarket,
  type DbcMarket,
  type Deployment,
} from "@/lib/chain-client";
import type { MarketTrade } from "@/lib/market-types";
import { amountFormatIssue, maxTokenAmount, slippageIssue, tokenAmountIssue } from "@/lib/transaction-constraints";
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
    priceReliable: trade.priceReliable,
    volumeQuote: trade.quoteAmount,
    side: trade.side,
  }));
  const pricedTrades = chronological.filter((trade) => trade.priceReliable !== false);
  const firstPrice = pricedTrades[0]?.priceInPair;
  const lastPrice = market.priceInPair;
  return {
    ...market,
    changePercent: firstPrice && lastPrice && pricedTrades.length > 1
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
      activityLoaded: current.activityLoaded || snapshot.activityLoaded,
      createdAt: snapshot.createdAt ?? current.createdAt,
    },
    [...snapshot.trades, ...current.trades],
  );
}

function mergeLiveTrade(market: DbcMarket, trade: MarketTrade): DbcMarket {
  if (market.trades.some((item) => item.signature === trade.signature)) return market;
  return withTrades(market, [trade, ...market.trades]);
}

export function MarketTerminal({ initialMarket, b200ReferencePrice: initialB200ReferencePrice }: {
  initialMarket: DbcMarket;
  b200ReferencePrice: number | null;
}) {
  const [market, setMarket] = useState(initialMarket);
  const [b200ReferencePrice, setB200ReferencePrice] = useState(initialB200ReferencePrice);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const { address: wallet, connect } = useWallet();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amountUnit, setAmountUnit] = useState<"input" | "output">("input");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [balances, setBalances] = useState({ b200: 0, token: 0, sol: 0 });
  const [balancesReady, setBalancesReady] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Connect a wallet to trade.");
  const [signature, setSignature] = useState<string | null>(null);
  const [partialFill, setPartialFill] = useState<{ spent: number; unspent: number } | null>(null);
  const [lastLiveSignature, setLastLiveSignature] = useState<string | null>(null);
  const [chartSource, setChartSource] = useState<"official" | "gmgn">("official");
  const [launchNotice, setLaunchNotice] = useState("");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("cx-launch-notice");
    if (!stored) return;
    sessionStorage.removeItem("cx-launch-notice");
    try {
      const notice = JSON.parse(stored) as { pool?: string; message?: string; at?: number };
      if (notice.pool !== initialMarket.address || !notice.message || !notice.at || Date.now() - notice.at > 60_000) return;
      // The toast is transient state transferred from the launch route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLaunchNotice(notice.message);
      const timer = window.setTimeout(() => setLaunchNotice(""), 6000);
      return () => window.clearTimeout(timer);
    } catch { /* Ignore expired or malformed transient notices. */ }
  }, [initialMarket.address]);

  useEffect(() => {
    loadDeployment().then(setDeployment).catch(() => setMessage("The market deployment is temporarily unavailable."));
  }, []);

  useEffect(() => {
    const refreshReference = async () => {
      try {
        const response = await fetch("/api/indices/b200", { cache: "no-store" });
        if (!response.ok) return;
        const snapshot = await response.json() as { price?: number };
        const price = snapshot.price;
        if (typeof price === "number" && Number.isFinite(price) && price > 0) setB200ReferencePrice(price);
      } catch {
        // Keep the last valid reference while the oracle endpoint recovers.
      }
    };
    void refreshReference();
    const timer = setInterval(() => { void refreshReference(); }, 300_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!deployment || !wallet) return;
    let active = true;
    // Prevent previous account balances from enabling a trade during refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBalancesReady(false);
    setBalanceError("");
    dbcMarketBalances(deployment, initialMarket).then((next) => {
      if (active) { setBalances(next); setBalancesReady(true); }
    }).catch(() => { if (active) setBalanceError("Could not check your balance. Refresh the page."); });
    return () => { active = false; };
  }, [deployment, initialMarket, wallet]);

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
    const source = new EventSource(`/api/markets/${market.address}/stream${market.migrated ? "?migrated=1" : ""}`);
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
  }, [market.address, market.migrated, refreshMarket]);

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
    const nextAddress = await connect();
    if (!nextAddress) throw new Error("Wallet connection failed.");
    if (!deployment) throw new Error("The market deployment is still loading.");
    setBalances(await dbcMarketBalances(deployment, market));
    setMessage("Wallet connected.");
  });

  const handleTrade = () => run("trade", async () => {
    if (!deployment || !wallet) throw new Error("Connect a wallet before trading.");
    const currentBalances = await dbcMarketBalances(deployment, market);
    setBalances(currentBalances); setBalancesReady(true);
    const inputSymbol = mode === "buy" ? "cmB200" : market.symbol;
    const currentProblem = amountUnit === "input"
      ? tokenAmountIssue(amount, mode === "buy" ? currentBalances.b200 : currentBalances.token, inputSymbol)
      : amountFormatIssue(amount) || ((mode === "buy" ? currentBalances.b200 : currentBalances.token) <= 0 ? `You need ${inputSymbol} to trade.` : null);
    if (currentProblem) throw new Error(currentProblem);
    if (currentBalances.sol < 0.00001) throw new Error("Add a little SOL for network fees.");
    const slippagePercent = Number(slippage);
    const slippageBps = Math.round(slippagePercent * 100);
    if (!Number.isFinite(slippagePercent) || slippagePercent < 0 || slippagePercent >= 100) {
      throw new Error("Enter slippage from 0% up to, but below, 100%.");
    }
    const result = market.migrated
      ? await tradeDammMarket(deployment, market, mode, Number(amount), slippageBps, amountUnit === "output")
      : await tradeDbcMarket(deployment, market, mode, Number(amount), slippageBps, amountUnit === "output");
    setSignature(result.signature);
    const indexed = await refreshMarket(result.signature).catch(() => false);
    const output = result.estimatedOut.toLocaleString(undefined, { maximumFractionDigits: 6 });
    if (!indexed) {
      setMessage("Trade submitted. Market data is syncing.");
      return;
    }
    if (!market.migrated && mode === "buy" && result.unusedInput > 0) {
      setPartialFill({ spent: result.actualInput, unspent: result.unusedInput });
      setMessage(`Final buy partially filled at the curve boundary. Received approximately ${output} tokens.`);
    } else {
      setMessage(`${mode === "buy" ? "Buy" : "Sell"} complete. Received approximately ${output}.`);
    }
  });

  const handleMigration = () => run("migrate", async () => {
    if (!deployment || !wallet) throw new Error("Connect a wallet before migrating this market.");
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
  const createdLabel = market.createdAt ? new Date(market.createdAt).toLocaleString() : market.activityLoaded ? "Unavailable" : "Loading…";
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
  const inputSymbol = mode === "buy" ? "cmB200" : market.symbol;
  const outputSymbol = mode === "buy" ? market.symbol : "cmB200";
  const inputBalance = mode === "buy" ? balances.b200 : balances.token;
  const amountNumber = Number(amount);
  const estimatedInput = amountUnit === "output" && Number.isFinite(amountNumber) && amountNumber > 0 && market.priceInPair > 0
    ? mode === "buy" ? amountNumber * market.priceInPair : amountNumber / market.priceInPair
    : null;
  const amountProblem = wallet
    ? amountUnit === "input"
      ? tokenAmountIssue(amount, balancesReady ? inputBalance : null, inputSymbol)
      : amountFormatIssue(amount)
        || (balancesReady && inputBalance <= 0 ? `You need ${inputSymbol} to trade.` : null)
        || (balancesReady && estimatedInput !== null && estimatedInput > inputBalance ? `Not enough ${inputSymbol} for this amount.` : null)
    : null;
  const tradeProblem = wallet
    ? balanceError || amountProblem || slippageIssue(slippage)
      || (balancesReady && balances.sol < 0.00001 ? "Add a little SOL for network fees." : null)
    : null;

  return (
    <main className={styles.page}>
      <SiteHeader />
      {launchNotice && <div aria-live="polite" className={styles.launchToast} role="status"><span>{launchNotice}</span><button aria-label="Dismiss notification" onClick={() => setLaunchNotice("")} type="button">×</button></div>}

      <section className={styles.identityStrip}>
        <div className={styles.tokenIdentity}>
          {market.logo ? (
            <Image alt={`${market.name} logo`} className={styles.tokenLogo} height={58} onError={(event) => { event.currentTarget.src = "/brand/cx-emblem-green.png"; }} referrerPolicy="no-referrer" src={market.logo} unoptimized width={58} />
          ) : <span className={styles.tokenGlyph}>{market.name.slice(0, 2).toUpperCase()}</span>}
          <div><h1>{market.name} <span>${market.symbol}</span></h1><p>{short(market.mint)} / cmB200 · {market.migrated ? "DAMM v2" : "Bonding curve"}</p></div>
        </div>
        <div className={styles.primaryQuote}>
          <span>Price</span>
          <strong>{formatPrice(market.priceInPair)} cmB200</strong>
          <small>{usdPrice === null ? "USD unavailable" : `≈ ${formatUsd(usdPrice)}`}</small>
        </div>
        <div className={styles.identityMetric}><span>Market cap now</span><strong>{market.marketCapQuote === null ? "—" : b200Usd(market.marketCapQuote, b200ReferencePrice)}</strong><small>{market.marketCapQuote === null ? "Unavailable" : `${market.marketCapQuote.toLocaleString("en-US", { maximumFractionDigits: 2 })} cmB200`}</small></div>
        <div className={styles.identityMetric}><span>Change</span><strong className={change !== null && change < 0 ? styles.negative : styles.positive}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</strong><small>{market.activityLoaded ? `${market.tradeCount} trades · ${market.volumeQuote.toFixed(4)} cmB200 vol.` : "Loading trade history…"}</small></div>
      </section>

      <section className={styles.terminalGrid}>
        <div className={styles.marketMain}>
          <nav aria-label="Chart data source" className={styles.chartSourceBar}>
            <div className={styles.chartSourceTabs}>
              <button aria-pressed={chartSource === "official"} onClick={() => setChartSource("official")} type="button">
              CX <span>Official</span>
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
            <MarketChart activityLoaded={market.activityLoaded} b200ReferencePrice={b200ReferencePrice} currentPrice={market.priceInPair} history={market.history} />
          )}

          <section className={styles.tapePanel}>
            <div className={styles.sectionHeader}>
              <div><h2>Trades</h2></div>
              <button disabled={busy !== null} onClick={() => void run("refresh", async () => { await refreshMarket(); })} type="button">{busy === "refresh" ? "Refreshing…" : "Refresh"}</button>
            </div>
            {market.trades.length ? (
              <div aria-live="polite" className={styles.tradeTable}>
                <div aria-hidden="true" className={styles.tradeHead}><span>Time</span><span>Side</span><span>Price</span><span>{market.symbol}</span><span>cmB200</span><span>Transaction</span></div>
                {market.trades.map((trade) => (
                  <div className={`${styles.tradeRow} ${trade.signature === lastLiveSignature ? styles.tradeRowLive : ""}`} key={trade.signature}>
                    <span>{new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <strong className={trade.side === "buy" ? styles.positive : styles.negative}>{trade.side.toUpperCase()}</strong>
                    <span className={styles.b200Cell} title={trade.priceReliable === false ? "This tiny trade is below cmB200 price precision." : undefined}>{trade.priceReliable === false ? "—" : formatPrice(trade.priceInPair)}{trade.priceReliable !== false && <small>{b200Usd(trade.priceInPair, b200ReferencePrice)}</small>}</span>
                    <span>{trade.baseAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                    <span className={styles.b200Cell}>{trade.quoteAmount.toFixed(6)}<small>{b200Usd(trade.quoteAmount, b200ReferencePrice)}</small></span>
                    <a href={`https://explorer.solana.com/tx/${trade.signature}${explorerCluster}`} rel="noreferrer" target="_blank">{short(trade.signature)} ↗</a>
                  </div>
                ))}
              </div>
            ) : <div className={styles.tapeEmpty}>{market.activityLoaded ? "No swaps yet." : "Loading trades…"}</div>}
          </section>

          <section className={styles.detailPanel}>
            <div className={styles.sectionHeader}><div><h2>Details</h2></div></div>
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
          <div className={styles.railState}><strong>{status}</strong><small>{latest ? `Last swap ${new Date(latest.timestamp).toLocaleTimeString()}` : market.activityLoaded ? "No swaps yet" : "Loading trades…"}</small></div>
          <div className={styles.tradeTabs}>
            <button aria-pressed={mode === "buy"} disabled={market.migrationReady && !market.migrated} onClick={() => { setMode("buy"); setAmountUnit("input"); setAmount(""); }} type="button">Buy</button>
            <button aria-pressed={mode === "sell"} disabled={market.migrationReady && !market.migrated} onClick={() => { setMode("sell"); setAmountUnit("input"); setAmount(""); }} type="button">Sell</button>
          </div>
          <div className={styles.balanceGrid}>
            <span>cmB200 <strong>{wallet ? balances.b200.toFixed(4) : "—"}</strong><small>{wallet ? b200Usd(balances.b200, b200ReferencePrice) : "—"}</small></span>
            <span>{market.symbol} <strong>{wallet ? balances.token.toFixed(4) : "—"}</strong></span>
          </div>
          <div aria-label="Choose amount unit" className={styles.amountUnitTabs}>
            <button aria-pressed={amountUnit === "input"} onClick={() => { setAmountUnit("input"); setAmount(""); }} type="button">{mode === "buy" ? "Pay cmB200" : `Sell ${market.symbol}`}</button>
            <button aria-pressed={amountUnit === "output"} onClick={() => { setAmountUnit("output"); setAmount(""); }} type="button">{mode === "buy" ? `Get ${market.symbol}` : "Get cmB200"}</button>
          </div>
          <label className={styles.amountField}>
            <span>{amountUnit === "input" ? `Amount in ${inputSymbol}` : `Amount in ${outputSymbol}`}</span>
            <input disabled={market.migrationReady && !market.migrated} inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} step="any" type="number" value={amount} />
            {amountUnit === "input" && mode === "buy" && amountNumber > 0 && <small>{b200Usd(amountNumber, b200ReferencePrice)}</small>}
            {amountUnit === "output" && estimatedInput !== null && <small>About {estimatedInput.toLocaleString("en-US", { maximumFractionDigits: 6 })} {inputSymbol} before fees and price impact; exact quote checked before signing.</small>}
          </label>
          {wallet && balancesReady && amountUnit === "input" && <button className={styles.amountMax} disabled={busy !== null || inputBalance <= 0} onClick={() => setAmount(maxTokenAmount(inputBalance))} type="button">Use max {inputSymbol}</button>}
          <div className={styles.slippageControl}>
            <div className={styles.slippageHeading}><span>Slippage</span><strong>{slippage}%</strong></div>
            <div className={styles.slippageOptions}>
              {["0.5", "1", "3"].map((value) => <button aria-pressed={slippage === value} key={value} onClick={() => setSlippage(value)} type="button">{value}%</button>)}
              <label><span>Custom %</span><input aria-label="Custom slippage percent" inputMode="decimal" min="0" onChange={(event) => setSlippage(event.target.value)} step="any" type="number" value={slippage} /></label>
            </div>
          </div>
          {!market.migrated && !market.migrationReady && <p className={styles.tradeHint}>A final buy may partially fill; unspent cmB200 stays in your wallet.</p>}
          {wallet && tradeProblem && <p className={styles.tradeHint} role="status">{tradeProblem}</p>}
          {market.migrationReady && !market.migrated ? (
            <button className={styles.tradeButton} disabled={busy !== null} onClick={wallet ? handleMigration : handleConnect} type="button">
              {!wallet ? "Connect wallet to migrate" : busy === "migrate" ? "Migrating…" : "Migrate to DAMM v2"}
            </button>
          ) : (
            <button className={styles.tradeButton} disabled={busy !== null || Boolean(wallet && tradeProblem)} onClick={wallet ? handleTrade : handleConnect} type="button">
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
            <div><span>{market.usesCurrentCurve ? "Bonding curve" : "Earlier curve"}</span><strong>{graduationLabel(progress, market.migrated, market.migrationReady)}</strong></div>
            {market.openingMarketCapQuote !== null && market.graduationMarketCapQuote !== null && (
              <div className={styles.curveTargets}>
                <span>Curve start<strong>{b200Usd(market.openingMarketCapQuote, b200ReferencePrice)}</strong><small>{market.openingMarketCapQuote.toLocaleString("en-US")} cmB200</small></span>
                <span>Bond target<strong>{b200Usd(market.graduationMarketCapQuote, b200ReferencePrice)}</strong><small>{market.graduationMarketCapQuote.toLocaleString("en-US")} cmB200</small></span>
              </div>
            )}
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
