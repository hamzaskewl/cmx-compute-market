"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useNetwork } from "@/components/network-context";
import { loadDbcMarkets, type DbcMarket } from "@/lib/chain-client";
import styles from "@/app/markets/markets.module.css";

type SortKey = "volume" | "marketCap" | "newest";

function compact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function valueLabel(value: number | null, b200Usd: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return b200Usd === null
    ? `${compact(value)} cmB200`
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value * b200Usd);
}

function MarketCard({ market, b200Usd, activityError }: { market: DbcMarket; b200Usd: number | null; activityError: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logo = market.logo && /^https?:\/\//.test(market.logo) && !imageFailed;
  return <Link className={styles.marketCard} href={`/markets/${market.address}`}>
    <div className={styles.cardTop}>
      <span className={styles.tokenImage}>{logo
        ? <Image alt="" fill onError={() => setImageFailed(true)} sizes="58px" src={market.logo} unoptimized />
        : <span>{market.symbol.slice(0, 2)}</span>}</span>
      <span className={styles.cardIdentity}><strong>{market.name}</strong><small>${market.symbol} <i>/ cmB200</i></small></span>
      <span aria-hidden="true" className={styles.cardArrow}>↗</span>
    </div>
    <div className={styles.cardMetrics}>
      <span><small>MARKET CAP</small><strong>{valueLabel(market.marketCapQuote, b200Usd)}</strong>{b200Usd !== null && <em>{market.marketCapQuote === null ? "Unavailable" : `${compact(market.marketCapQuote)} cmB200`}</em>}</span>
      <span><small>RECENT VOLUME</small><strong>{market.activityLoaded ? valueLabel(market.volumeQuote, b200Usd) : activityError ? "Unavailable" : "Loading…"}</strong>{market.activityLoaded && b200Usd !== null && <em>{compact(market.volumeQuote)} cmB200</em>}</span>
    </div>
    <div className={styles.cardFoot}><span><i />{market.migrated ? "Graduated" : "Bonding curve"}</span><span>{market.createdAt ? new Date(market.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : market.activityLoaded ? "Launch date unavailable" : "Checking launch date"}</span></div>
  </Link>;
}

export function MarketsDirectory({ preview = false, b200Usd = null }: { preview?: boolean; b200Usd?: number | null }) {
  const { network } = useNetwork();
  const [markets, setMarkets] = useState<DbcMarket[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [activityError, setActivityError] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");

  const refresh = async () => {
    setActivityError(false);
    try {
      const result = await loadDbcMarkets();
      setMarkets(result.markets);
      setState("ready");
      const detailed = await loadDbcMarkets(true);
      setMarkets(detailed.markets);
    } catch { if (!markets.length) setState("error"); else setActivityError(true); }
  };

  useEffect(() => {
    let active = true;
    loadDbcMarkets()
      .then(async (result) => {
        if (!active) return;
        setMarkets(result.markets);
        setState("ready");
        try {
          const detailed = await loadDbcMarkets(true);
          if (active) setMarkets(detailed.markets);
        } catch { if (active) setActivityError(true); }
      })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return markets.filter((market) => !term || [market.name, market.symbol, market.mint, market.address]
      .some((value) => value.toLowerCase().includes(term)))
      .sort((a, b) => {
        if (sort === "marketCap") return (b.marketCapQuote ?? -1) - (a.marketCapQuote ?? -1) || (b.createdAt ?? 0) - (a.createdAt ?? 0);
        if (sort === "newest") return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        return (b.activityLoaded ? b.volumeQuote : -1) - (a.activityLoaded ? a.volumeQuote : -1)
          || (b.marketCapQuote ?? -1) - (a.marketCapQuote ?? -1);
      })
      .slice(0, preview ? 5 : undefined);
  }, [markets, preview, search, sort]);

  return <div className={styles.directory}>
    {preview ? <div className={styles.previewHead}><div><span>03 / EXPLORE MARKETS</span><h2>Built on compute.<br /><em>Trading now.</em></h2><p>Browse tokens paired with cmB200 on Solana {network === "devnet" ? "devnet" : "mainnet"}.</p></div><Link href="/markets">Explore all markets <span>↗</span></Link></div>
      : <div className={styles.directoryHead}><div><span>LIVE DIRECTORY</span><h2>All B200 markets <small>{state === "ready" ? markets.length : "—"}</small></h2></div><button onClick={() => void refresh()} type="button">Refresh ↻</button></div>}
    {!preview && <div className={styles.controls}>
      <label><span>SEARCH MARKETS</span><input aria-label="Search by name, ticker, token address, or pool address" onChange={(event) => setSearch(event.target.value)} placeholder="Name, ticker or contract address" type="search" value={search} /></label>
      <label><span>SORT BY</span><select aria-label="Sort markets" onChange={(event) => setSort(event.target.value as SortKey)} value={sort}><option value="volume">Recent volume</option><option value="marketCap">Market cap</option><option value="newest">Newest</option></select></label>
    </div>}
    {visible.length ? <div className={styles.cards}>{visible.map((market) => <MarketCard activityError={activityError} b200Usd={b200Usd} key={market.address} market={market} />)}</div>
      : state === "loading" ? <div aria-label="Loading B200 markets" className={styles.loadingCards} role="status"><span /><span /><span /></div>
      : <p className={styles.empty}>{state === "error" ? "Markets could not be loaded. Try refreshing." : search ? "No markets match your search." : "No tokens have launched yet."}</p>}
    <p className={styles.volumeNote}>Market cap is estimated from the current price and token supply. Volume covers the latest 40 trades; USD uses the Ornn B200 reference.</p>
  </div>;
}
