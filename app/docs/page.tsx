import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "How CX works | Compute Exchange",
  description: "How cmB200, Meteora DBC markets, and the proposed compute flywheel work on CX devnet.",
};

const sections = [
  { id: "asset", label: "The B200 asset" },
  { id: "launch", label: "Meteora DBC" },
  { id: "flywheel", label: "Proposed flywheel" },
  { id: "mainnet", label: "Before mainnet" },
];

export default function DocsPage() {
  return <main className={styles.page}>
    <SiteHeader />
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <strong>CX / DOCS</strong>
        <nav aria-label="Documentation sections">{sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.label}</a>)}</nav>
        <Link href="/launch">Open launchpad ↗</Link>
      </aside>
      <article className={styles.article}>
        <header className={styles.intro}>
          <span>DEVNET FIELD GUIDE</span>
          <h1>How CX works</h1>
          <p>A B200 GPU-hour reference becomes the quote asset for markets launched on Meteora. Here is what is live today and what still needs to be built.</p>
        </header>
        <nav aria-label="On this page" className={styles.contents}>
          <span>ON THIS PAGE</span>
          <div>{sections.map((section, index) => <a href={`#${section.id}`} key={section.id}><small>{String(index + 1).padStart(2, "0")}</small>{section.label}</a>)}</div>
        </nav>
        <section id="asset">
          <span>THE REFERENCE ASSET</span>
          <h2>Start with a B200 hour.</h2>
          <p>cmB200 tracks the <a href="https://ornnai.com/" rel="noreferrer" target="_blank">Ornn B200 GPU-hour reference ↗</a>. You mint it by depositing test quote assets at the fresh onchain price and redeem it by burning cmB200 against available reserve liquidity. The current program charges 0.30% on mint and redeem.</p>
          <div className={styles.assetMap} aria-label="B200 reference to market flow">
            <div><small>01 / PRICE</small><strong>Ornn B200 index</strong><span>GPU-hour reference</span></div>
            <b aria-hidden="true">→</b>
            <div><small>02 / ASSET</small><strong>cmB200</strong><span>Mint and redeem on devnet</span></div>
            <b aria-hidden="true">→</b>
            <div><small>03 / PAIR</small><strong>Token / cmB200</strong><span>Markets on Meteora DBC</span></div>
          </div>
          <div className={styles.note}><strong>On devnet</strong><span>These are test assets. The quote token is a synthetic test mint, not mainnet USDC. The oracle provides a reference price; it does not guarantee redemption or a peg.</span></div>
        </section>
        <section id="launch">
          <div className={styles.sectionTop}><span>THE LAUNCH</span><Image alt="Meteora" height={29} src="/brand/meteora.svg" width={125} /></div>
          <h2>Launch with Meteora DBC.</h2>
          <p>CX uses <a href="https://docs.meteora.ag/core-products/dbc/what-is-dbc" rel="noreferrer" target="_blank">Meteora Dynamic Bonding Curve ↗</a> to launch a token with cmB200 as its quote asset. The current curve starts at a 100 cmB200 market cap and targets 1,000 cmB200 at graduation. Liquidity migrates to Meteora DAMM v2 after the curve completes.</p>
          <p>You choose a name, ticker, image, description, and site. CX sets the curve and fees. The current curve fee is 2.00%; after Meteora&apos;s protocol share, the creator and CX split the remainder equally. Migrated liquidity positions are permanently locked under the current configuration.</p>
          <Link className={styles.sectionLink} href="/launch">Create a market ↗</Link>
        </section>
        <section id="flywheel">
          <span>THE PROPOSAL</span>
          <h2>Put market value back to work.</h2>
          <p>Markets paired with GPU-hours could direct a defined share of eligible fees into pair liquidity and, where the reserve design supports it, GPU collateral.</p>
          <div className={styles.flow}><div><small>MARKET ACTIVITY</small><strong>Trade</strong><span>Meteora DBC and DAMM v2</span></div><b>→</b><div><small>RULED ALLOCATION</small><strong>Direct fees</strong><span>Defined share and controls</span></div><b>→</b><div><small>PRODUCTIVE RESERVE</small><strong>Reinforce</strong><span>Liquidity or eligible assets</span></div></div>
          <div className={styles.note}><strong>Planned</strong><span>Automatic fee recycling and GPU purchases are not active. Allocation, custody, accounting, and onchain routing need a published design before this can be presented as live economics.</span></div>
        </section>
        <section id="mainnet">
          <span>READINESS</span>
          <h2>Before real funds.</h2>
          <ul>
            <li>Choose the real quote asset and replace the devnet synthetic mint and faucet.</li>
            <li>Finalize and independently review vault, oracle, fee routing, and redemption controls.</li>
            <li>Publish the flywheel percentage, custody model, eligible collateral, and disclosures.</li>
            <li>Deploy a mainnet manifest and program; run complete market and migration tests and establish keeper monitoring.</li>
          </ul>
          <p>CX remains on Solana devnet while these are designed and tested.</p>
        </section>
      </article>
    </div>
  </main>;
}
