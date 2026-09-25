import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { MarketsDirectory } from "@/components/markets-directory";
import { NetworkUnavailable } from "@/components/network-unavailable";
import { getOrnnB200Price } from "@/lib/ornn";
import { hasServerDeployment, readSelectedNetwork } from "@/lib/server-deployment";
import styles from "./markets.module.css";

export const metadata: Metadata = { title: "Markets | CX Compute Exchange", description: "Explore B200 markets on Solana. More GPU markets are coming soon." };

const upcoming = ["H100", "H200", "A100", "RTX 5090"];

export default async function MarketsPage() {
  const network = await readSelectedNetwork();
  if (!(await hasServerDeployment(network))) return <NetworkUnavailable network={network} />;
  const b200Usd = await getOrnnB200Price().catch(() => null);
  return <main className={styles.page}><SiteHeader /><div className={styles.body}><div className={styles.intro}><span>EXPLORE / 01</span><h1>Compute markets.</h1><p>Every token paired with cmB200 on Solana {network === "devnet" ? "devnet" : "mainnet"}. Search by name, ticker or contract address, then sort the market your way.</p><Link href="/launch">Create a B200 market ↗</Link></div><MarketsDirectory b200Usd={b200Usd} /><section className={styles.upcoming}><div><span>ON THE ROADMAP</span><h2>More compute,<br/>later.</h2></div><div className={styles.upcomingGrid}>{upcoming.map((name) => <div key={name}><strong>{name}</strong><span>COMING SOON</span></div>)}</div></section></div></main>;
}
