import { SiteHeader } from "@/components/site-header";
import styles from "@/app/market.module.css";

export default function LoadingMarket() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <div className={styles.loadingState}><span>Opening market</span><strong>Loading current price…</strong></div>
    </main>
  );
}
