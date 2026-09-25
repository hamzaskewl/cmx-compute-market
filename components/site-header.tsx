"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork } from "@/components/network-context";
import { useWallet } from "@/components/wallet-context";
import styles from "@/app/site.module.css";

export function CXMark({ className = "" }: { className?: string }) {
  return <Image aria-hidden="true" alt="" className={className} height={128} src="/brand/cx-emblem-green.png" width={128} />;
}

export function SiteHeader() {
  const pathname = usePathname();
  const { network, available, changing, error: networkError, selectNetwork } = useNetwork();
  const { address, connecting, restoring, error, connect, manage } = useWallet();
  return <header className={styles.header}>
    <Link className={styles.brand} href="/" aria-label="CX Compute Exchange home">
      <span className={styles.brandIcon}><CXMark /></span>
      <span className={styles.brandText}>Compute Exchange</span>
    </Link>
    <nav aria-label="Main navigation" className={styles.nav}>
      <Link aria-current={pathname === "/" ? "page" : undefined} href="/">Market</Link>
      <Link aria-current={pathname.startsWith("/markets") ? "page" : undefined} href="/markets">Explore</Link>
      <Link aria-current={pathname === "/launch" ? "page" : undefined} href="/launch">Launchpad</Link>
      <Link aria-current={pathname === "/docs" ? "page" : undefined} href="/docs">Docs</Link>
    </nav>
    <div className={styles.headerRight}>
      <div aria-label="Solana network" className={styles.networkSwitch} role="group">
        <button aria-pressed={network === "devnet"} disabled={changing} onClick={() => void selectNetwork("devnet")} type="button">Devnet</button>
        <button aria-pressed={network === "mainnet-beta"} disabled={changing} onClick={() => void selectNetwork("mainnet-beta")} type="button">Mainnet</button>
      </div>
      <button aria-haspopup={address ? "dialog" : undefined} className={styles.connect} disabled={connecting || restoring || changing || !available} onClick={() => address ? manage() : void connect()} title={!available ? "Mainnet is not live yet" : address ? "Manage wallet" : error ?? undefined} type="button">
        {connecting ? "Connecting…" : restoring ? "Restoring…" : address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Connect wallet"}
        <span aria-hidden="true">{address ? "⌄" : "↗"}</span>
      </button>
    </div>
    {(error || networkError) && <span className={styles.walletError} role="alert">{networkError || error}</span>}
  </header>;
}
