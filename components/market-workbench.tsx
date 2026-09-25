"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  balances,
  claimTestUsdc,
  connectWallet,
  createDbcLaunch,
  loadDbcMarkets,
  loadDeployment,
  protocolStats,
  tradeIndex,
  uploadLogoToIrys,
  verifyDeployment,
  type DbcMarket,
  type Deployment,
  type ProtocolStats,
  type WalletBalances,
} from "@/lib/chain-client";
import styles from "@/app/page.module.css";

const emptyWallet: WalletBalances = { sol: 0, quote: 0, token: 0 };

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function ExplorerLink({ signature, mainnet }: { signature: string; mainnet: boolean }) {
  return (
    <a href={`https://explorer.solana.com/tx/${signature}${mainnet ? "" : "?cluster=devnet"}`} rel="noreferrer" target="_blank">
      View transaction ↗
    </a>
  );
}

function formatPrice(value: number) {
  if (value >= 0.01) return value.toFixed(4);
  return value.toLocaleString("en-US", { maximumFractionDigits: 10 });
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

function MarketSparkline({ market }: { market: DbcMarket }) {
  const points = market.history;
  if (points.length === 0) return <span className={styles.sparklineEmpty}>No swaps yet</span>;
  const prices = points.map((point) => point.priceInPair);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const span = maximum - minimum || maximum || 1;
  const path = points.map((point, index) => {
    const x = points.length === 1 ? 58 : (index / (points.length - 1)) * 116;
    const y = 34 - ((point.priceInPair - minimum) / span) * 28;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg aria-label={`${market.name} swap history`} className={styles.marketSparkline} role="img" viewBox="0 0 116 40">
      <path d="M0 35.5H116" stroke="#435159" strokeWidth="1" />
      {points.length === 1
        ? <circle cx="58" cy="20" fill="#959cf7" r="3" />
        : <path d={path} fill="none" stroke="#959cf7" strokeWidth="2" />}
    </svg>
  );
}

async function prepareLogo(file: File) {
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) throw new Error("Use a PNG, JPEG, or WebP logo.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Logo files must be 2 MB or smaller.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) throw new Error("The logo could not be prepared for upload.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "market-logo"}.webp`, { type: "image/webp" });
}

export function MarketWorkbench({ b200ReferencePrice }: { b200ReferencePrice: number | null }) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [programReady, setProgramReady] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [walletBalances, setWalletBalances] = useState(emptyWallet);
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [indexMode, setIndexMode] = useState<"buy" | "sell">("buy");
  const [indexAmount, setIndexAmount] = useState("100");
  const [markets, setMarkets] = useState<DbcMarket[]>([]);
  const [marketsLoaded, setMarketsLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Connect Phantom to trade or create a market.");
  const [signature, setSignature] = useState<string | null>(null);
  const [launch, setLaunch] = useState({
    name: "",
    ticker: "",
    description: "",
    website: "",
    logo: "",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoDragging, setLogoDragging] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  const refreshMarkets = useCallback(async () => {
    const result = await loadDbcMarkets();
    setMarkets(result.markets);
    setMarketsLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    loadDeployment()
      .then(async (nextDeployment) => {
        const verification = await verifyDeployment(nextDeployment);
        if (!active) return;
        setDeployment(nextDeployment);
        setProgramReady(verification.executable);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Market data is temporarily unavailable.");
      });
    loadDbcMarkets()
      .then((marketResult) => {
        if (!active) return;
        setMarkets(marketResult.markets);
        setMarketsLoaded(true);
      })
      .catch(() => {
        if (active) {
          setMarketsLoaded(true);
          setMessage("Market discovery needs a refresh.");
        }
      });
    return () => { active = false; };
  }, []);

  const refreshWallet = useCallback(async (nextDeployment = deployment) => {
    if (!nextDeployment || !wallet) return;
    const [nextBalances, nextStats] = await Promise.all([
      balances(nextDeployment, "B200"),
      protocolStats(nextDeployment, "B200"),
    ]);
    setWalletBalances(nextBalances);
    setStats(nextStats);
  }, [deployment, wallet]);

  const run = async (label: string, task: () => Promise<string | null>) => {
    setBusy(label);
    setSignature(null);
    try {
      const result = await task();
      if (result) setSignature(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The transaction did not complete.");
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = () => run("connect", async () => {
    const publicKey = await connectWallet();
    setWallet(publicKey.toBase58());
    if (!deployment) throw new Error("The market setup is still loading.");
    const [nextBalances, nextStats] = await Promise.all([
      balances(deployment, "B200"),
      protocolStats(deployment, "B200"),
    ]);
    setWalletBalances(nextBalances);
    setStats(nextStats);
    setMessage("Wallet connected.");
    return null;
  });

  const handleFaucet = () => run("faucet", async () => {
    if (!deployment) throw new Error("The market setup is still loading.");
    if (deployment.cluster !== "devnet") throw new Error("The test faucet is available only on devnet.");
    const nextSignature = await claimTestUsdc(deployment);
    setMessage("10,000 test USDC claimed. This faucet is one-time per wallet.");
    await refreshWallet(deployment);
    return nextSignature;
  });

  const handleIndexTrade = () => run("index", async () => {
    if (!deployment) throw new Error("The market setup is still loading.");
    const onchain = deployment.indices.find((index) => index.symbol === "B200")?.price;
    if (!onchain) throw new Error("The B200 on-chain price is unavailable.");
    const nextSignature = await tradeIndex(
      deployment,
      "B200",
      indexMode,
      Number(indexAmount),
      onchain,
    );
    setMessage(indexMode === "buy" ? "cmB200 minted against the reserve." : "cmB200 burned and redeemed from the reserve.");
    await refreshWallet(deployment);
    return nextSignature;
  });

  const handleLaunch = () => run("launch", async () => {
    if (!deployment) throw new Error("The market setup is still loading.");
    let logo = "";
    if (logoFile) {
      setMessage("Approve the logo signature, then the two Meteora launch transactions.");
      logo = await uploadLogoToIrys(deployment, logoFile);
    }
    setMessage("Approve two transactions: the DBC pool, then its public market metadata.");
    const result = await createDbcLaunch(deployment, { ...launch, logo });
    await refreshMarkets();
    setMessage(`Market created on Meteora DBC. Pool ${short(result.pool)} is paired with cmB200.`);
    setLaunch({ name: "", ticker: "", description: "", website: "", logo: "" });
    setLogoFile(null);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(null);
    if (logoInput.current) logoInput.current.value = "";
    return result.metadataSignature;
  });

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const prepared = await prepareLogo(file);
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoFile(prepared);
      setLogoPreview(URL.createObjectURL(prepared));
      setMessage("Logo prepared as an optimized WebP. It will upload to Irys when you launch.");
    } catch (error) {
      setLogoFile(null);
      setMessage(error instanceof Error ? error.message : "That logo could not be used.");
    }
  };

  const handleLogoDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setLogoDragging(false);
    void chooseLogo(event.dataTransfer.files[0]);
  };

  const coverage = stats?.coveragePercent;
  const isMainnet = deployment?.cluster === "mainnet-beta";

  return (
    <section aria-labelledby="trade-title" className={styles.workbench} id="trade">
      <div className={styles.workbenchHeading}>
        <div>
          <span className={styles.eyebrow}>GPU-hour markets on Solana</span>
          <h2 id="trade-title">B200 market desk</h2>
          <p>Mint the GPU-hour index, launch any token against it on Meteora, then trade the full loop.</p>
        </div>
        <button className={styles.walletButton} disabled={busy === "connect"} onClick={handleConnect} type="button">
          {wallet ? short(wallet) : busy === "connect" ? "Connecting…" : "Connect Phantom"}
        </button>
      </div>

      <div className={styles.networkStrip}>
        <strong>{programReady ? "B200 protocol" : "Loading B200 protocol"}</strong>
        <span>{deployment ? (isMainnet ? "Solana mainnet" : "Solana devnet") : "Network loading"}</span>
        <span>Meteora DBC</span>
        <span>cmB200 quote</span>
        <span>2.00% launch fee</span>
        <span>DAMM v2 graduation</span>
      </div>

      <div className={styles.deskGrid}>
        <section className={styles.deskPanel}>
          <div className={styles.panelTitle}>
            <div><span>01</span><h3>Mint / redeem cmB200</h3></div>
            <em>0.30% fee</em>
          </div>

          <div className={styles.priceBlock}>
            <span>Latest Ornn reference</span>
            <strong>{b200ReferencePrice ? `$${b200ReferencePrice.toFixed(4)}` : "Unavailable"}</strong>
            <small>USD per B200 GPU-hour</small>
          </div>

          <dl className={styles.reserveGrid}>
            <div><dt>B200 reference</dt><dd>{stats ? `$${stats.onchainPrice.toFixed(4)}` : "Connect"}</dd></div>
            <div><dt>Quote reserve</dt><dd>{stats ? `$${stats.reserve.toFixed(2)}` : "Connect"}</dd></div>
            <div><dt>cmB200 supply</dt><dd>{stats ? <><span>{stats.circulating.toFixed(4)}</span><small>{b200Usd(stats.circulating, b200ReferencePrice)}</small></> : "Connect"}</dd></div>
            <div><dt>Coverage</dt><dd>{coverage === null || coverage === undefined ? "No liability" : `${coverage.toFixed(2)}%`}</dd></div>
          </dl>

          <div className={styles.balanceLine}>
            <span>USDC <strong>{walletBalances.quote.toFixed(2)}</strong></span>
            <span>cmB200 <strong>{walletBalances.token.toFixed(4)}<small>{b200Usd(walletBalances.token, b200ReferencePrice)}</small></strong></span>
          </div>
          {deployment?.cluster === "devnet" && (
            <button className={styles.secondaryButton} disabled={!wallet || busy !== null} onClick={handleFaucet} type="button">
              Claim 10,000 test USDC
            </button>
          )}

          <div className={styles.tradeTabs}>
            <button aria-pressed={indexMode === "buy"} onClick={() => setIndexMode("buy")} type="button">Buy cmB200</button>
            <button aria-pressed={indexMode === "sell"} onClick={() => setIndexMode("sell")} type="button">Redeem cmB200</button>
          </div>
          <label className={styles.fieldLabel}>
            <span>{indexMode === "buy" ? "USDC in" : "cmB200 in"}</span>
            <input inputMode="decimal" min="0" onChange={(event) => setIndexAmount(event.target.value)} step="any" type="number" value={indexAmount} />
            {indexMode === "sell" && Number(indexAmount) > 0 && <small className={styles.fieldHint}>{b200Usd(Number(indexAmount), b200ReferencePrice)}</small>}
          </label>
          <button className={styles.primaryButton} disabled={!wallet || busy !== null} onClick={handleIndexTrade} type="button">
            {busy === "index" ? "Confirming…" : indexMode === "buy" ? "Mint cmB200" : "Redeem cmB200"}
          </button>
        </section>

        <section className={styles.deskPanel}>
          <div className={styles.panelTitle}>
            <div><span>02</span><h3>Launch against B200</h3></div>
            <em>Permissionless DBC</em>
          </div>
          <p className={styles.panelIntro}>Create a fixed-supply token with cmB200 as its quote asset. No token approval or Meteora badge is required for this standard SPL configuration.</p>
          <div className={styles.formGrid}>
            <label className={styles.fieldLabel}><span>Name</span><input maxLength={32} onChange={(event) => setLaunch({ ...launch, name: event.target.value })} placeholder="B200 Compute Club" value={launch.name} /></label>
            <label className={styles.fieldLabel}><span>Ticker</span><input maxLength={8} onChange={(event) => setLaunch({ ...launch, ticker: event.target.value })} placeholder="B2CLUB" value={launch.ticker} /></label>
          </div>
          <label className={styles.fieldLabel}><span>Description</span><textarea maxLength={72} onChange={(event) => setLaunch({ ...launch, description: event.target.value })} placeholder="What this compute-attached market represents" rows={3} value={launch.description} /></label>
          <label className={styles.fieldLabel}><span>Website <em>optional</em></span><input onChange={(event) => setLaunch({ ...launch, website: event.target.value })} placeholder="https://" type="url" value={launch.website} /></label>
          <label
            className={`${styles.logoDropzone} ${logoDragging ? styles.logoDropzoneActive : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setLogoDragging(true); }}
            onDragLeave={() => setLogoDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleLogoDrop}
          >
            <input
              accept="image/png,image/jpeg,image/webp"
              className={styles.logoFileInput}
              onChange={(event) => void chooseLogo(event.target.files?.[0])}
              ref={logoInput}
              type="file"
            />
            {logoPreview ? (
              <Image alt="Selected market logo preview" className={styles.logoPreview} height={56} src={logoPreview} unoptimized width={56} />
            ) : <span className={styles.logoDropIcon}>+</span>}
            <span className={styles.logoDropCopy}>
              <strong>{logoFile ? logoFile.name : "Drop a market logo"}</strong>
              <small>PNG, JPEG, or WebP · max 2 MB · optimized before Irys upload</small>
            </span>
            <span className={styles.logoBrowse}>Choose file</span>
          </label>
          <dl className={styles.launchTerms}>
            <div><dt>Opening market cap</dt><dd><span>100 cmB200</span><small>{b200Usd(100, b200ReferencePrice)}</small></dd></div>
            <div><dt>Graduation market cap</dt><dd><span>1,000 cmB200</span><small>{b200Usd(1_000, b200ReferencePrice)}</small></dd></div>
            <div><dt>Curve fee split</dt><dd>50% creator / 50% CMX*</dd></div>
            <div><dt>Post-migration LP</dt><dd>50 / 50 permanently locked</dd></div>
          </dl>
          <button className={styles.primaryButton} disabled={!wallet || busy !== null || !launch.name || !launch.ticker} onClick={handleLaunch} type="button">
            {busy === "launch" ? "Creating on Meteora…" : "Create B200 market"}
          </button>
          <small className={styles.finePrint}>*The Meteora protocol share is deducted before the creator/partner remainder is split.</small>
        </section>
      </div>

      <section className={styles.launchBoard}>
        <div className={styles.launchBoardHeader}>
          <div><span className={styles.eyebrow}>Market discovery</span><h3>B200 launches</h3><p>Bonding-curve charts with DAMM v2 routing after graduation.</p></div>
          <button className={styles.refreshButton} disabled={busy !== null} onClick={() => run("refresh", async () => { await refreshMarkets(); setMessage("Markets refreshed."); return null; })} type="button">Refresh</button>
        </div>
        {markets.length > 0 ? (
          <div className={styles.marketDirectory}>
            <div aria-hidden="true" className={styles.marketDirectoryLabels}>
              <span>Market</span><span>Activity</span><span>Price / graduation</span><span />
            </div>
            {markets.map((market) => (
              <Link className={styles.marketRow} href={`/markets/${market.address}`} key={market.address}>
                <span className={styles.marketIdentity}>
                  {market.logo ? (
                    <Image alt="" className={styles.tokenLogo} height={42} onError={(event) => { event.currentTarget.src = "/brand/cx-emblem.png"; }} referrerPolicy="no-referrer" src={market.logo} unoptimized width={42} />
                  ) : <span className={styles.tokenGlyph}>{market.name.slice(0, 2).toUpperCase()}</span>}
                  <span><strong>{market.name}</strong><small>{short(market.mint)} · {market.migrated ? "DAMM v2" : "DBC curve"}</small></span>
                </span>
                <span className={styles.marketHistoryCell}>
                  <MarketSparkline market={market} />
                  <small>{market.tradeCount} swaps · {market.volumeQuote.toFixed(4)} cmB200<br />{b200Usd(market.volumeQuote, b200ReferencePrice)}</small>
                </span>
                <span className={styles.marketPriceCell}>
                  <strong>{formatPrice(market.priceInPair)} cmB200</strong>
                  <small>{b200Usd(market.priceInPair, b200ReferencePrice)}</small>
                  <small>{graduationLabel(market.progressPercent, market.migrated, market.migrationReady)}{market.migrated || market.migrationReady ? "" : " to graduation"}</small>
                  <span className={styles.rowProgress}><span style={{ width: `${Math.min(100, market.progressPercent)}%` }} /></span>
                </span>
                <span aria-hidden="true" className={styles.marketArrow}>→</span>
              </Link>
            ))}
          </div>
        ) : <p className={styles.emptyMarkets}>{marketsLoaded ? "No B200 launch pools are available yet." : "Loading B200 markets…"}</p>}
      </section>

      <div className={styles.transactionStatus} aria-live="polite">
        <span>{busy ? "Working" : "Activity"}</span>
        <p>{message}</p>
        {signature && <ExplorerLink mainnet={isMainnet} signature={signature} />}
      </div>
    </section>
  );
}
