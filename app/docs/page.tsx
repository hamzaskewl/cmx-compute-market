import Link from "next/link";
import { getOrnnSnapshot } from "@/lib/ornn";
import styles from "./docs.module.css";

function Mark() {
  return (
    <svg aria-hidden="true" className={styles.mark} viewBox="0 0 28 28">
      <path d="M20.75 7.25A9.5 9.5 0 1 0 20.75 20.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
      <path d="m18.25 9.5 4.75 4.5-4.75 4.5" fill="none" stroke="#8e95ff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
    </svg>
  );
}

const sections = [
  { id: "overview", label: "Overview" },
  { id: "reference", label: "Reference data" },
  { id: "vault", label: "Mint and redeem" },
  { id: "markets", label: "Markets" },
  { id: "status", label: "Network" },
];

function formatUsd(value: number | null) {
  return value === null
    ? "USD reference unavailable"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default async function DocsPage() {
  const snapshot = await getOrnnSnapshot().catch(() => null);
  const b200 = snapshot?.indices.find((index) => index.symbol === "B200")?.price ?? null;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <Mark />
          <span>Compute Market</span>
        </Link>
        <Link className={styles.back} href="/">Back to indexes <span aria-hidden="true">→</span></Link>
      </header>

      <div className={styles.docsShell}>
        <aside className={styles.sidebar}>
          <p>Protocol docs</p>
          <nav aria-label="Documentation sections">
            {sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.label}</a>)}
          </nav>
          <a className={styles.sourceLink} href="#reference">Pricing methodology <span aria-hidden="true">↓</span></a>
        </aside>

        <article className={styles.content}>
          <section className={styles.intro} id="overview">
            <h1>GPU-hour indexes<br />for Solana markets.</h1>
            <p className={styles.lead}>Compute Market turns composite GPU reference prices into onchain index assets. cmB200 markets are available now; H100, H200, A100 and RTX 5090 are research previews.</p>
          </section>

          <section className={styles.section} id="reference">
            <div>
              <h2>Reference data</h2>
              <p>Reference prices are aggregated across multiple market inputs into one USD-per-GPU-hour composite. The web app refreshes every five minutes and shows no replacement value when the feed is unavailable.</p>
              <div className={styles.callout}><strong>Available now</strong><span>cmB200 · H100, H200, A100 and RTX 5090 coming soon</span></div>
            </div>
          </section>

          <section className={styles.section} id="vault">
            <div>
              <h2>Mint and redeem</h2>
              <p>The current Solana program models each index with its own quote vault. A mint deposits quote assets and receives index tokens at the fresh reference price. A redemption burns index tokens and returns available quote liquidity.</p>
              <p>The prototype program applies a 0.30% index-swap fee. Redemption is bounded by real vault liquidity; the oracle itself does not guarantee a peg.</p>
            </div>
          </section>

          <section className={styles.section} id="markets">
            <div>
              <h2>Markets</h2>
              <p>Permissionless launch tokens use Meteora Dynamic Bonding Curve with cmB200 as the quote asset. The CMX config charges a fixed 2.00% curve fee and gives creators 50% of the creator/partner remainder after Meteora&apos;s protocol share.</p>
              <p>The curve opens at a 100 cmB200 market cap ({formatUsd(b200 === null ? null : b200 * 100)}) and targets a 1,000 cmB200 graduation market cap ({formatUsd(b200 === null ? null : b200 * 1_000)}). These are market-cap targets, not the amount deposited into the curve. For this curve shape, the onchain migration threshold is 240.253073 cmB200 ({formatUsd(b200 === null ? null : b200 * 240.253073)}).</p>
              <p>The last buy can partially fill at the curve boundary, leaving the unused cmB200 in the trader&apos;s wallet. After the threshold is reached, liquidity migrates to DAMM v2. Creator and CMX each receive 50% of the liquidity position, with both portions permanently locked.</p>
            </div>
          </section>

          <section className={styles.section} id="status">
            <div>
              <h2>Network</h2>
              <div className={styles.status}><span aria-hidden="true" />Public beta · Solana devnet</div>
              <p>The current public beta uses test assets. The same DBC program and DAMM v2 migration path are deployed on Solana mainnet, but this release does not involve mainnet funds.</p>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
