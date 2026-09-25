import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { MarketsDirectory } from "@/components/markets-directory";
import styles from "./markets.module.css";

export const metadata: Metadata = { title: "Markets | CX Compute Exchange", description: "Explore B200 markets on Solana devnet. More GPU markets are coming soon." };

const upcoming = ["H100", "H200", "A100", "RTX 5090"];

export default function MarketsPage() { return <main className={styles.page}><SiteHeader /><div className={styles.body}><div className={styles.intro}><span>EXPLORE / 01</span><h1>Compute markets.</h1><p>B200 is live on devnet. More GPU-hour assets are planned and cannot be traded yet.</p><Link href="/launch">Create a B200 market ↗</Link></div><MarketsDirectory /><section className={styles.upcoming}><div><span>ON THE ROADMAP</span><h2>More compute,<br/>later.</h2></div><div className={styles.upcomingGrid}>{upcoming.map((name) => <div key={name}><strong>{name}</strong><span>COMING SOON</span></div>)}</div></section></div></main>; }
