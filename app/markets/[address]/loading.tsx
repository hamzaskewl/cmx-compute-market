import styles from "@/app/market.module.css";

export default function LoadingMarket() {
  return (
    <main className={styles.page}>
      <div className={styles.loadingState}><span>Reading Solana</span><strong>Loading B200 market…</strong></div>
    </main>
  );
}
