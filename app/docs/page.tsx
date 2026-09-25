import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { NetworkUnavailable } from "@/components/network-unavailable";
import { hasServerDeployment, readSelectedNetwork, readServerDeployment } from "@/lib/server-deployment";
import { getOrnnSnapshot } from "@/lib/ornn";
import type { Deployment } from "@/lib/chain-client";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "How CX works | Compute Exchange",
  description: "How cmB200, Meteora DBC markets, and the proposed compute flywheel work on CX.",
};

export default async function DocsPage() {
  const network = await readSelectedNetwork();
  if (!(await hasServerDeployment(network))) return <NetworkUnavailable network={network} />;
  const [deployment, snapshot] = await Promise.all([
    readServerDeployment<Deployment>(network),
    getOrnnSnapshot().catch(() => null),
  ]);
  const b200Usd = snapshot?.indices.find((entry) => entry.symbol === "B200")?.price ?? null;
  const marketCapUsd = (value: number) => b200Usd === null
    ? null
    : (value * b200Usd).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const openingMarketCapUsd = marketCapUsd(deployment.dbc.initialMarketCapInQuote);
  const graduationMarketCapUsd = marketCapUsd(deployment.dbc.migrationMarketCapInQuote);
  const isDevnet = network === "devnet";
  const quoteLabel = isDevnet ? "test USDC" : "USDC";
  const sections = [
    { id: "asset", label: "The B200 asset" },
    { id: "launch", label: "Meteora DBC" },
    { id: "flywheel", label: "Proposed flywheel" },
    ...(isDevnet ? [{ id: "mainnet", label: "Before mainnet" }] : []),
  ];
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
          <span>{isDevnet ? "DEVNET FIELD GUIDE" : "MAINNET FIELD GUIDE"}</span>
          <h1>How CX works</h1>
          <p>Start with {quoteLabel}, mint cmB200, then use it to buy tokens launched here. This page explains the price, redemption, and launch steps.</p>
        </header>
        <section id="asset">
          <span>THE REFERENCE ASSET</span>
          <h2>What is cmB200?</h2>
          <p>cmB200 is a token priced from the <a href="https://ornnai.com/" rel="noreferrer" target="_blank">Ornn B200 GPU-hour reference ↗</a>. You pay {quoteLabel} to mint it. You can then use cmB200 to buy tokens launched on CX, or burn it to receive {quoteLabel} from the reserve. Minting and redemption each charge 0.30%; redemption requires enough liquidity in the reserve.</p>
          <div className={styles.assetMap} aria-label="B200 reference to market flow">
            <div><small>01 / PRICE</small><strong>Ornn B200 index</strong><span>GPU-hour reference</span></div>
            <b aria-hidden="true">→</b>
            <div><small>02 / ASSET</small><strong>cmB200</strong><span>Mint and redeem on {isDevnet ? "devnet" : "mainnet"}</span></div>
            <b aria-hidden="true">→</b>
            <div><small>03 / PAIR</small><strong>Token / cmB200</strong><span>Markets on Meteora DBC</span></div>
          </div>
          <div className={styles.note}><strong>{isDevnet ? "On devnet" : "About cmB200"}</strong><span>{isDevnet ? "Test USDC is a synthetic devnet token, not mainnet USDC. " : ""}cmB200 does not grant GPU time or hardware ownership. The Ornn price is a reference, not a guaranteed market price or redemption promise.</span></div>
        </section>
        <section id="launch">
          <div className={styles.sectionTop}><span>THE LAUNCH</span><Image alt="Meteora" height={29} src="/brand/meteora.svg" width={125} /></div>
          <h2>Launch with Meteora DBC.</h2>
          <p>CX launches each token on a <a href="https://docs.meteora.ag/core-products/dbc/what-is-dbc" rel="noreferrer" target="_blank">Meteora Dynamic Bonding Curve ↗</a>. Buyers pay cmB200 and receive the token; sellers make the reverse trade. When the curve completes, a migration transaction creates a DAMM v2 pool. Trading and charts continue on the same CX market page.</p>
          <dl className={styles.curveFacts}>
            <div><dt>Starting market cap</dt><dd>{openingMarketCapUsd ? <>≈{openingMarketCapUsd}<small>{deployment.dbc.initialMarketCapInQuote.toLocaleString("en-US")} cmB200</small></> : `${deployment.dbc.initialMarketCapInQuote.toLocaleString("en-US")} cmB200`}</dd></div>
            <div><dt>Graduation target</dt><dd>{graduationMarketCapUsd ? <>≈{graduationMarketCapUsd}<small>{deployment.dbc.migrationMarketCapInQuote.toLocaleString("en-US")} cmB200</small></> : `${deployment.dbc.migrationMarketCapInQuote.toLocaleString("en-US")} cmB200`}</dd></div>
          </dl>
          <p>You choose a name, ticker, image, description, and site. CX sets the curve and fees. The active curve fee is {(deployment.dbc.tradingFeeBps / 100).toFixed(2)}%; after Meteora&apos;s protocol share, the creator and CX split the remainder equally. Migrated liquidity positions are permanently locked under the current configuration.</p>
          <Link className={styles.sectionLink} href="/launch">Create a market ↗</Link>
        </section>
        <section id="flywheel">
          <span>THE PROPOSAL</span>
          <h2>Put market value back to work.</h2>
          <p>Markets paired with GPU-hours could direct a defined share of eligible fees into pair liquidity and, where the reserve design supports it, GPU collateral.</p>
          <div className={styles.flow}><div><small>MARKET ACTIVITY</small><strong>Trade</strong><span>Meteora DBC and DAMM v2</span></div><b>→</b><div><small>RULED ALLOCATION</small><strong>Direct fees</strong><span>Defined share and controls</span></div><b>→</b><div><small>PRODUCTIVE RESERVE</small><strong>Reinforce</strong><span>Liquidity or eligible assets</span></div></div>
          <div className={styles.note}><strong>Planned</strong><span>Automatic fee recycling and GPU purchases are not active. Allocation, custody, accounting, and onchain routing need a published design before this can be presented as live economics.</span></div>
        </section>
        {isDevnet && <section id="mainnet">
          <span>READINESS</span>
          <h2>Before real funds.</h2>
          <ul className={styles.readinessList}>
            <li>Choose the real quote asset and replace the devnet synthetic mint and faucet.</li>
            <li>Finalize and independently review vault, oracle, fee routing, and redemption controls.</li>
            <li>Publish the flywheel percentage, custody model, eligible collateral, and disclosures.</li>
            <li>Deploy a mainnet manifest and program; run complete market and migration tests and establish keeper monitoring.</li>
          </ul>
          <div className={styles.note}><strong>Current status</strong><span>CX remains on Solana devnet while these are designed and tested.</span></div>
        </section>}
      </article>
    </div>
  </main>;
}
