import Link from "next/link";
import { IndexLedger } from "@/components/index-ledger";
import { MarketWorkbench } from "@/components/market-workbench";
import { getOrnnHistory, getOrnnSnapshot, type OrnnIndex } from "@/lib/ornn";
import styles from "./page.module.css";

export const revalidate = 300;

const INDEX_ORDER: OrnnIndex["symbol"][] = ["B200", "H100", "H200", "A100", "5090"];

function BrandMark() {
  return (
    <svg aria-hidden="true" className={styles.brandMark} viewBox="0 0 28 28">
      <path d="M20.75 7.25A9.5 9.5 0 1 0 20.75 20.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
      <path d="m18.25 9.5 4.75 4.5-4.75 4.5" fill="none" stroke="#8e95ff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg aria-hidden="true" className={styles.arrow} viewBox="0 0 24 24">
      <path d="M5 12h13M13 7l5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.6" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 34 34">
      <path d="m17 3 12 7v14l-12 7-12-7V10l12-7Zm0 0v14m12-7-12 7m-12-7 12 7m0 14V17" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 34 34">
      <path d="m4 10 13-7 13 7-13 7L4 10Zm0 7 13 7 13-7M4 24l13 7 13-7" fill="none" stroke="currentColor" strokeLinejoin="miter" strokeWidth="2" />
    </svg>
  );
}

function ChainIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 34 34">
      <path d="M8 6h14l5 5v17H8V6Zm14 0v6h5M12 18h11M12 23h8" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

async function readSnapshot() {
  try {
    return await getOrnnSnapshot();
  } catch {
    return { indices: [], date: null, source: "Composite reference" as const };
  }
}

export default async function Home() {
  const snapshot = await readSnapshot();
  const indices = [...snapshot.indices].sort(
    (left, right) => INDEX_ORDER.indexOf(left.symbol) - INDEX_ORDER.indexOf(right.symbol),
  );
  const historyEntries = await Promise.all(
    indices.map(async (index) => {
      try {
        return [index.symbol, await getOrnnHistory(index.name)] as const;
      } catch {
        return [index.symbol, []] as const;
      }
    }),
  );
  const histories = Object.fromEntries(historyEntries);
  const b200 = indices.find((index) => index.symbol === "B200");
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <a className={styles.brand} href="#top" aria-label="Compute Market home">
          <BrandMark />
          <span>Compute Market</span>
        </a>
        <nav aria-label="Main navigation" className={styles.nav}>
          <a href="#indexes">Indexes</a>
          <a href="#trade">Trade</a>
          <a href="#mechanism">Mechanism</a>
          <Link href="/docs">Docs</Link>
        </nav>
        <Link aria-label="Read pricing methodology" className={styles.headerAction} href="/docs#reference">
          <span>Methodology</span> <Arrow />
        </Link>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.proposition}>
          <div>
            <h1>Real GPU<br />pricing.</h1>
            <p>Composite GPU-hour indexes aggregated across multiple market inputs.</p>
            <div className={styles.actions}>
              <a className={styles.primaryAction} href="#indexes">
                Explore indexes <Arrow />
              </a>
              <Link className={styles.textAction} href="/docs">Read the docs</Link>
            </div>
          </div>

          {indices.length > 0 && (
            <dl className={styles.metadata}>
              <div><dt>Unit</dt><dd>USD / GPU-hour</dd></div>
              <div><dt>Method</dt><dd>{snapshot.source}</dd></div>
            </dl>
          )}
        </div>

        <section aria-labelledby="ledger-title" className={styles.ledger} id="indexes">
          <div className={styles.ledgerTopline}>
            <h2 id="ledger-title">GPU index ledger</h2>
            <span>Aggregated reference prices</span>
          </div>

          {indices.length > 0 ? (
            <>
              <div aria-hidden="true" className={styles.columnLabels}>
                <span>GPU</span><span>Index <em>(USD / GPU-hour)</em></span><span>Method</span>
              </div>
              <IndexLedger histories={histories} indices={indices} />
            </>
          ) : (
            <p className={styles.feedState}>The composite reference feed is temporarily unavailable.</p>
          )}
        </section>
      </section>

      <MarketWorkbench b200ReferencePrice={b200?.price ?? null} />

      <section aria-labelledby="mechanism-title" className={styles.mechanism} id="mechanism">
        <h2 id="mechanism-title">The mechanism</h2>
        <div className={styles.mechanismFlow}>
          <div className={styles.step}><span className={styles.stepNumber}>01</span><span className={styles.stepIcon}><CubeIcon /></span><strong>Composite reference</strong></div>
          <Arrow />
          <div className={styles.step}><span className={styles.stepNumber}>02</span><span className={styles.stepIcon}><LayersIcon /></span><strong>Vault mint / redeem</strong></div>
          <Arrow />
          <div className={styles.step}><span className={styles.stepNumber}>03</span><span className={styles.stepIcon}><ChainIcon /></span><strong>Solana market</strong></div>
          <Link className={styles.mechanismDocs} href="/docs">Read the docs</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <a className={styles.footerBrand} href="#top"><BrandMark /><span>Compute Market</span></a>
        <span>Aggregated pricing · Solana protocol</span>
      </footer>
    </main>
  );
}
