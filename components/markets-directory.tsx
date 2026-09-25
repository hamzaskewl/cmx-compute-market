"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadDbcMarkets, type DbcMarket } from "@/lib/chain-client";
import styles from "@/app/markets/markets.module.css";

export function MarketsDirectory() {
  const [markets, setMarkets] = useState<DbcMarket[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const refresh = async () => {
    setState("loading");
    try { const result = await loadDbcMarkets(); setMarkets(result.markets); setState("ready"); }
    catch { setState("error"); }
  };
  useEffect(() => {
    loadDbcMarkets()
      .then((result) => { setMarkets(result.markets); setState("ready"); })
      .catch(() => setState("error"));
  }, []);
  return <div className={styles.directory}>
    <div className={styles.directoryHead}><h2>B200 launch markets</h2><button onClick={() => void refresh()} type="button">Refresh ↻</button></div>
    {markets.length > 0 ? <div className={styles.rows}>{markets.map((market) => <Link href={`/markets/${market.address}`} key={market.address}><span className={styles.token}>{market.name.slice(0, 2)}</span><span><strong>{market.name}</strong><small>{market.mint.slice(0, 4)}…{market.mint.slice(-4)} / cmB200</small></span><span className={styles.marketStatus}>{market.migrated ? "DAMM v2" : "DBC curve"}</span><span className={styles.marketArrow}>↗</span></Link>)}</div> : <p className={styles.empty}>{state === "loading" ? "Loading B200 markets…" : state === "error" ? "Markets could not be loaded. Try refreshing." : "No B200 launch markets are available yet."}</p>}
  </div>;
}
