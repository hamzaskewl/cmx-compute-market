"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MarketTerminal } from "@/components/market-terminal";
import { SiteHeader } from "@/components/site-header";
import { loadDbcMarket, loadDbcMarkets, type DbcMarket } from "@/lib/chain-client";
import styles from "@/app/market.module.css";

export function MarketPageLoader({ address }: { address: string }) {
  const [market, setMarket] = useState<DbcMarket | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError("");
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        // The directory snapshot is much cheaper than reconstructing every
        // historical swap before the market page can open.
        let found: DbcMarket | undefined;
        try {
          found = (await loadDbcMarkets()).markets.find((item) => item.address === address);
        } catch {
          // A direct pool read can still succeed if the directory RPC is busy.
        }
        const next = found ?? (await loadDbcMarket(address, false, true)).market;
        if (active) setMarket(next);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Market data is temporarily unavailable.");
      }
    };
    void load();
    return () => { active = false; };
  }, [address, attempt]);

  if (market) return <MarketTerminal b200ReferencePrice={null} initialMarket={market} />;

  return <main className={styles.page}>
    <SiteHeader />
    {error ? <div className={styles.marketError} role="alert">
      <h1>Market data is temporarily unavailable.</h1>
      <p>{error}</p>
      <div><button onClick={retry} type="button">Try again</button><Link href="/markets">Explore markets</Link></div>
    </div> : <div className={styles.loadingState} role="status"><span>Opening market</span><strong>Loading current price…</strong></div>}
  </main>;
}
