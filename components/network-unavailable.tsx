"use client";

import { SiteHeader } from "@/components/site-header";
import { useNetwork } from "@/components/network-context";
import type { SolanaCluster } from "@/lib/market-types";
import styles from "./network-unavailable.module.css";

export function NetworkUnavailable({ network }: { network: SolanaCluster }) {
  const { changing, selectNetwork } = useNetwork();
  return <main className={styles.page}>
    <SiteHeader />
    <section className={styles.content}>
      <span className={styles.status}><i />{network === "mainnet-beta" ? "SOLANA MAINNET" : "SOLANA DEVNET"}</span>
      <h1>{network === "mainnet-beta" ? "Mainnet isn't live yet." : "Devnet is unavailable."}</h1>
      <p>{network === "mainnet-beta"
        ? "CX has no mainnet deployment configured yet. Mainnet markets and cmB200 will appear here once the deployment is verified."
        : "The devnet deployment is not configured. Please try again later."}</p>
      {network === "mainnet-beta" && <div className={styles.actions}>
        <button disabled={changing} onClick={() => void selectNetwork("devnet")} type="button">Explore Devnet <span aria-hidden="true">↗</span></button>
      </div>}
      <small>{network === "mainnet-beta" ? "Devnet uses test assets and is available for the hackathon demo." : "Check back for the test deployment."}</small>
    </section>
  </main>;
}
