import Link from "next/link";
import { B200Chart } from "@/components/b200-chart";
import { B200Trade } from "@/components/b200-trade";
import { SiteHeader, CXMark } from "@/components/site-header";
import { getOrnnHistory, getOrnnSnapshot } from "@/lib/ornn";
import styles from "./page.module.css";

export const revalidate = 300;

export default async function Home() {
  const [snapshot, history] = await Promise.all([
    getOrnnSnapshot().catch(() => null),
    getOrnnHistory("B200").catch(() => []),
  ]);
  const b200 = snapshot?.indices.find((entry) => entry.symbol === "B200") ?? null;
  return <main className={styles.page}>
    <SiteHeader />
    <section className={styles.marketHero} id="top">
      <div className={styles.heroLead}><div><span className={styles.kicker}>THE COMPUTE EXCHANGE / LIVE ON DEVNET</span><h1>The market for <em>GPU-hours.</em></h1></div><Link href="/launch">Launch a market <span>↗</span></Link></div>
      <B200Chart history={history} price={b200?.price ?? null} />
      <div className={styles.heroBottom}><span><i /> B200 IS LIVE ON DEVNET</span><p>Watch the price of real compute. Mint its market asset. Build the next market on top.</p><a href="#trade">Explore B200 <span>↓</span></a></div>
    </section>
    <B200Trade />
    <section className={styles.thesis} aria-labelledby="thesis-title">
      <span className={styles.sectionIndex}>02 / WHY COMPUTE</span>
      <div className={styles.thesisGrid}><h2 id="thesis-title">A coin can trade.<br/><em>Compute can work.</em></h2><div><p>GPU demand is a different way to think about an asset behind a market. A B200 hour is a unit of useful compute, with a price you can see and a market you can build around.</p><p>Instead of sending market fees to another inference wrapper, our proposed flywheel directs value toward the pair’s liquidity and, where viable, the GPU reserve.</p><Link href="/docs#flywheel">See the flywheel ↗</Link></div></div>
      <div className={styles.flywheel}><div><span>01</span><strong>Launch</strong><small>A token pairs with cmB200 on Meteora DBC.</small></div><b>↗</b><div><span>02</span><strong>Trade</strong><small>The B200 pair develops real liquidity.</small></div><b>↗</b><div><span>03</span><strong>Reinvest</strong><small>Proposed: route an agreed share to liquidity or the GPU reserve.</small></div></div>
      <p className={styles.proposal}>The reinvestment step is a proposal, not an active fee route on devnet. Allocation and onchain controls must be set before mainnet.</p>
    </section>
    <section className={styles.launchPromo} aria-labelledby="launch-title"><div><span className={styles.sectionIndex}>03 / BUILD ON IT</span><h2 id="launch-title">Your idea.<br/><em>A compute pair.</em></h2><p>Create a token paired with cmB200 through Meteora Dynamic Bonding Curve. Shape the market; CX handles the fixed launch configuration.</p><Link href="/launch">Open launchpad <span>↗</span></Link></div><div className={styles.launchArt}><div className={styles.artMark}><CXMark /></div><span>YOUR TOKEN</span><strong>×</strong><span>cmB200</span><div className={styles.artBars}><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><small>POWERED BY METEORA DBC</small></div></section>
    <footer className={styles.footer}><div><CXMark /><span>COMPUTE EXCHANGE</span></div><nav aria-label="Footer"><Link href="/launch">Launchpad</Link><Link href="/markets">Markets</Link><Link href="/docs">Docs</Link></nav><span>Built on Solana devnet · Powered by Meteora DBC</span></footer>
  </main>;
}
