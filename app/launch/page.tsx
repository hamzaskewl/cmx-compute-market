import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { Launchpad } from "@/components/launchpad";
import { getOrnnHistory, getOrnnSnapshot } from "@/lib/ornn";
import styles from "./launch.module.css";

export const metadata: Metadata = { title: "Launchpad | CX Compute Exchange", description: "Launch a token paired with B200 GPU-hours using Meteora Dynamic Bonding Curve on Solana devnet." };
export const revalidate = 300;

export default async function LaunchPage() {
  const [history, snapshot] = await Promise.all([
    getOrnnHistory("B200").catch(() => []),
    getOrnnSnapshot().catch(() => null),
  ]);
  const b200 = snapshot?.indices.find((entry) => entry.symbol === "B200");
  return <main className={styles.page}><SiteHeader /><Launchpad history={history} price={b200?.price ?? null} updatedAt={b200?.date ?? null} /></main>;
}
