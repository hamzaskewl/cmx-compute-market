"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import styles from "@/app/market.module.css";

export default function MarketError({ retry }: { retry: () => void }) {
  return <main className={styles.page}>
    <SiteHeader />
    <div className={styles.marketError} role="alert">
      <h1>Market data is temporarily unavailable.</h1>
      <p>The network did not return a complete market snapshot. Try loading it again.</p>
      <div><button onClick={() => retry()} type="button">Try again</button><Link href="/markets">Explore markets</Link></div>
    </div>
  </main>;
}
