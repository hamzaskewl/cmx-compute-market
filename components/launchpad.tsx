"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWallet } from "@/components/wallet-context";
import { useNetwork } from "@/components/network-context";
import { createDbcLaunch, loadDeployment, uploadLogoToIrys, verifyDeployment, walletSolBalance, type Deployment } from "@/lib/chain-client";
import type { OrnnHistoryPoint } from "@/lib/ornn";
import { PoweredBySlider } from "@/components/powered-by-slider";
import styles from "@/app/launch/launch.module.css";

type Form = { name: string; ticker: string; description: string; website: string };
const initial: Form = { name: "", ticker: "", description: "", website: "" };

async function prepareLogo(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Image must be smaller than 2 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .82));
  if (!blob) throw new Error("Could not prepare image.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "token"}.webp`, { type: "image/webp" });
}

export function Launchpad({ history, price, updatedAt }: { history: OrnnHistoryPoint[]; price: number | null; updatedAt: string | null }) {
  const router = useRouter();
  const { address, connect, error: walletError } = useWallet();
  const { network } = useNetwork();
  const isDevnet = network === "devnet";
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<Form>(initial);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walletSolState, setWalletSolState] = useState<{ address: string; sol: number } | null>(null);
  const walletSol = walletSolState?.address === address ? walletSolState.sol : null;
  const [notice, setNotice] = useState("");
  const [b200Chart, setB200Chart] = useState({ history, price, updatedAt });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    loadDeployment().then(async (next) => {
      const verification = await verifyDeployment(next);
      if (active) { setDeployment(next); setReady(verification.executable); }
    }).catch((cause: unknown) => { if (active) setNotice(cause instanceof Error ? cause.message : "Launchpad unavailable."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!deployment || !address) return;
    let active = true;
    walletSolBalance(deployment).then((balance) => { if (active) setWalletSolState({ address, sol: balance }); }).catch(() => { if (active) setWalletSolState(null); });
    return () => { active = false; };
  }, [address, deployment]);

  useEffect(() => {
    const controller = new AbortController();
    const refreshChart = async () => {
      try {
        const response = await fetch("/api/b200-chart", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { history?: OrnnHistoryPoint[]; price?: number | null; updatedAt?: string | null };
        if (!controller.signal.aborted && Array.isArray(payload.history)) {
          setB200Chart({ history: payload.history, price: typeof payload.price === "number" ? payload.price : null, updatedAt: payload.updatedAt ?? null });
        }
      } catch { /* Keep the last valid reference visible when the feed is unavailable. */ }
    };
    const interval = window.setInterval(() => void refreshChart(), 300_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, []);

  const chooseLogo = async (file?: File) => {
    if (!file) return;
    try {
      const prepared = await prepareLogo(file);
      setLogoFile(prepared);
      setLogoPreview((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(prepared); });
      setNotice("");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not use image."); }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault(); setDragging(false);
    void chooseLogo(event.dataTransfer.files[0]);
  };

  const submit = async () => {
    if (!deployment || !address || !ready || !form.name.trim() || !form.ticker.trim() || walletSol === null || walletSol < 0.01) return;
    setBusy(true); setNotice("");
    try {
      let logo = "";
      if (logoFile) {
        setNotice("Approve the image upload signature in your wallet.");
        logo = await uploadLogoToIrys(deployment, logoFile);
      }
      setNotice("Approve the Meteora DBC pool and market metadata transactions.");
      const result = await createDbcLaunch(deployment, { ...form, logo });
      sessionStorage.setItem("cx-launch-notice", JSON.stringify({
        pool: result.pool,
        message: result.metadataWarning ?? `${form.ticker.trim().toUpperCase()} is live on ${isDevnet ? "devnet" : "mainnet"}.`,
        at: Date.now(),
      }));
      setForm(initial); setLogoFile(null);
      setLogoPreview((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
      if (inputRef.current) inputRef.current.value = "";
      router.push(`/markets/${result.pool}`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Launch failed."); }
    finally { setBusy(false); }
  };

  const websiteIssue = form.website.trim() && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(form.website.trim()) ? "Use an HTTPS website URL or leave it blank." : null;
  const valid = form.name.trim().length > 0 && form.ticker.trim().length > 0 && !websiteIssue;
  const launchIssue = !form.name.trim() || !form.ticker.trim()
    ? "Add a name and ticker to enable launch."
    : websiteIssue ?? (walletSol === null
      ? "Checking your wallet SOL balance…"
      : walletSol < 0.01 ? `Add at least 0.01 ${isDevnet ? "devnet " : ""}SOL for market setup and network fees.` : null);
  const previewWebsite = /^https?:\/\//i.test(form.website) ? form.website : null;
  const latestHistory = b200Chart.history.at(-1);
  const currentPoint = b200Chart.price !== null && b200Chart.updatedAt && (!latestHistory || Date.parse(b200Chart.updatedAt) > Date.parse(latestHistory.timestamp))
    ? [{ timestamp: b200Chart.updatedAt, price: b200Chart.price }]
    : [];
  const latestTimestamp = Date.parse(currentPoint.at(-1)?.timestamp ?? latestHistory?.timestamp ?? "");
  const threeMonthsAgo = new Date(latestTimestamp);
  threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3);
  const points = [...b200Chart.history, ...currentPoint]
    .filter((point) => Number.isFinite(Date.parse(point.timestamp)) && Date.parse(point.timestamp) >= threeMonthsAgo.getTime())
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const low = points.length ? Math.min(...points.map((point) => point.price)) : null;
  const high = points.length ? Math.max(...points.map((point) => point.price)) : null;
  const chartPadding = low !== null && high !== null ? Math.max((high - low) * .08, high * .015) : 0;
  const chartDomain: [number, number] = [Math.max(0, (low ?? 0) - chartPadding), (high ?? 1) + chartPadding];
  const b200Price = b200Chart.price;
  return <div className={styles.body}>
    <section className={styles.intro}><div><span className={styles.chapter}>THE LAUNCHPAD / 01</span><h1>Launch your token<br/><em>against B200.</em></h1><p>Buyers pay cmB200 to receive your token. cmB200 is priced from the B200 GPU-hour reference{isDevnet ? " and can be minted with test USDC on devnet" : ""}.</p></div></section>
    <div className={styles.launchGrid}>
      <section className={styles.formPanel} aria-label="Create a B200 market">
        <div className={styles.panelHead}><h2>Create token</h2><div className={styles.dbcBadge}><span>POWERED BY</span><Image alt="Meteora" height={22} src="/brand/meteora.svg" width={95} /><strong>DBC</strong></div></div>
        <div className={styles.twoFields}>
          <label className={styles.field}><span>Name <small>Required</small></span><input autoComplete="off" maxLength={32} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Blackwell Compute" value={form.name} /></label>
          <label className={styles.field}><span>Ticker <small>Required</small></span><input autoComplete="off" maxLength={8} onChange={(event) => setForm({ ...form, ticker: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="e.g. BWELL" value={form.ticker} /></label>
        </div>
        <label className={styles.field}><span>Description <small>Optional</small></span><textarea maxLength={72} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What is this market about?" rows={3} value={form.description} /><small className={styles.counter}>{form.description.length}/72</small></label>
        <label className={styles.field}><span>Website <small>Optional</small></span><input onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://" type="url" value={form.website} /></label>
        <label className={`${styles.upload} ${dragging ? styles.dragging : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <input accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseLogo(event.target.files?.[0])} ref={inputRef} type="file" />
          {logoPreview ? <Image alt="Selected token image" height={58} src={logoPreview} unoptimized width={58} /> : <span className={styles.uploadGlyph}>↗</span>}
          <span><strong>{logoFile?.name ?? "Add a token image"}</strong><small>PNG, JPEG or WebP · 2 MB max</small></span><em>Choose file</em>
        </label>
        <div className={styles.terms}>
          <div><span>Trading pair</span><strong>{form.ticker || "YOUR TICKER"} / cmB200</strong></div>
          <div><span>After graduation</span><strong>Trades move to DAMM v2</strong></div>
          <div><span>Starting market cap</span><strong>{deployment && b200Price !== null ? `≈${(deployment.dbc.initialMarketCapInQuote * b200Price).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}` : "—"}<small>{deployment?.dbc.initialMarketCapInQuote.toLocaleString("en-US") ?? "—"} cmB200</small></strong></div>
          <div><span>Graduation target</span><strong>{deployment && b200Price !== null ? `≈${(deployment.dbc.migrationMarketCapInQuote * b200Price).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}` : "—"}<small>{deployment?.dbc.migrationMarketCapInQuote.toLocaleString("en-US") ?? "—"} cmB200</small></strong></div>
        </div>
        <button className={styles.launchButton} disabled={busy || !ready || (address !== null && (!valid || Boolean(launchIssue)))} onClick={() => address ? void submit() : void connect()} type="button">{busy ? `Creating ${form.ticker || "market"}…` : !address ? "Connect wallet to launch ↗" : `Launch ${form.ticker || "token"} market ↗`}</button>
        {address && launchIssue && <p className={styles.hint} role="status">{launchIssue}</p>}
        {(notice || walletError) && <p className={styles.notice} role="status">{notice || walletError}</p>}
      </section>
      <aside className={styles.previewPanel} aria-label="Live market preview">
        <div className={styles.previewHeading}><span>LIVE PREVIEW</span><span>UPDATES AS YOU TYPE <i /></span></div>
        <div className={styles.previewCard}>
          <div className={styles.previewBanner}><span>B200 / COMPUTE MARKET</span><span>{isDevnet ? "DEVNET" : "MAINNET"}</span></div>
          <div className={styles.previewIdentity}>{logoPreview ? <Image alt="" height={94} src={logoPreview} unoptimized width={94} /> : <span className={styles.previewPlaceholder}>{form.ticker.slice(0, 2) || "—"}</span>}<div><span>YOUR MARKET</span><h2>{form.name || "Your token name"}</h2><strong>${form.ticker || "TICKER"} <i>/ cmB200</i></strong></div></div>
          {form.description && <p className={styles.previewDescription}>{form.description}</p>}
          <div className={styles.previewChart}>
            <div className={styles.previewChartHeader}><div><span>B200 GPU-HOUR REFERENCE</span><strong>{b200Price === null ? "Price unavailable" : `$${b200Price.toFixed(4)}`}<small> / hour</small></strong></div><span>ORNN · 3M</span></div>
            <div className={styles.previewChartCanvas} role="img" aria-label={points.length > 1 ? `Actual Ornn B200 GPU-hour price history for the past three months, from $${low?.toFixed(2)} to $${high?.toFixed(2)} per hour.` : "B200 price history is unavailable."}>
              {points.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ top: 10, right: 2, left: 2, bottom: 0 }}><defs><linearGradient id="launchB200Fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#76b900" stopOpacity={0.22} /><stop offset="100%" stopColor="#76b900" stopOpacity={0} /></linearGradient></defs><YAxis domain={chartDomain} hide type="number" /><XAxis dataKey="timestamp" axisLine={false} tickLine={false} minTickGap={38} tick={{ fill: "#9e9e9e", fontSize: 9 }} tickFormatter={(value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })} /><Tooltip content={({ active, payload, label }) => active && payload?.[0]?.value !== undefined ? <div className={styles.chartTooltip}><span>{new Date(String(label)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><strong>${Number(payload[0].value).toFixed(4)} / hour</strong></div> : null} cursor={{ stroke: "#bbb" }} /><Area dataKey="price" type="monotone" stroke="#76b900" strokeWidth={2} dot={false} fill="url(#launchB200Fill)" isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <p>Price history is temporarily unavailable.</p>}
            </div>
            {low !== null && high !== null && <div className={styles.chartRange}><span>3M LOW <strong>${low.toFixed(2)}</strong></span><span>3M HIGH <strong>${high.toFixed(2)}</strong></span></div>}
            <div className={styles.previewChartFoot}><span>Ornn B200 reference · refreshed every 5 min</span><span>{form.ticker ? `Not ${form.ticker} price` : "Not your token price"}</span></div>
          </div>
          <PoweredBySlider compact />
          <div className={styles.plannedLine}><span>IN DEVELOPMENT</span><strong>Fee routing · deeper liquidity · GPU reserve design</strong></div>
          <div className={styles.previewStats}><div><span>BASE ASSET</span><strong>${form.ticker || "TICKER"}</strong></div><div><span>QUOTE ASSET</span><strong>cmB200</strong></div><div><span>NETWORK</span><strong>Solana {isDevnet ? "devnet" : "mainnet"}</strong></div></div>
          {previewWebsite && <a className={styles.previewSite} href={previewWebsite} rel="noreferrer" target="_blank">{previewWebsite} ↗</a>}
        </div>
        <div className={styles.meteora}><div><Image alt="Meteora" height={36} src="/brand/meteora.svg" width={150} /></div><p>Powered by Meteora Dynamic Bonding Curve. CX sets the curve and fee split for this {isDevnet ? "devnet" : "mainnet"} launch. Liquidity migrates to DAMM v2 at graduation.</p></div>
      </aside>
    </div>
  </div>;
}
