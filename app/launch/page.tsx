import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { Launchpad } from "@/components/launchpad";
import { NetworkUnavailable } from "@/components/network-unavailable";
import { getOrnnHistory, getOrnnSnapshot } from "@/lib/ornn";
import { hasServerDeployment, readSelectedNetwork } from "@/lib/server-deployment";
import styles from "./launch.module.css";

export const metadata: Metadata = { title: "Launchpad | CX Compute Exchange", description: "Launch a token paired with cmB200 using Meteora Dynamic Bonding Curve on Solana." };
export const revalidate = 300;

export default async function LaunchPage() {
  const network = await readSelectedNetwork();
  if (!(await hasServerDeployment(network))) return <NetworkUnavailable network={network} />;
  const [history, snapshot] = await Promise.all([
    getOrnnHistory("B200").catch(() => []),
    getOrnnSnapshot().catch(() => null),
  ]);
  const b200 = snapshot?.indices.find((entry) => entry.symbol === "B200");
  return <main className={styles.page}><SiteHeader /><Launchpad history={history} price={b200?.price ?? null} updatedAt={b200?.date ?? null} /></main>;
}
