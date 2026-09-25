"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/components/wallet-context";
import styles from "@/app/site.module.css";

export function CXMark({ className = "" }: { className?: string }) {
  return <Image aria-hidden="true" alt="" className={className} height={128} src="/brand/cx-emblem.png" width={128} />;
}

export function SiteHeader() {
  const pathname = usePathname();
  const { address, connecting, error, connect } = useWallet();
  return <header className={styles.header}>
    <Link className={styles.brand} href="/" aria-label="CX Compute Exchange home">
      <span className={styles.brandIcon}><CXMark /></span>
      <span className={styles.brandText}>Compute Exchange</span>
    </Link>
    <nav aria-label="Main navigation" className={styles.nav}>
      <Link aria-current={pathname === "/" ? "page" : undefined} href="/">Market</Link>
      <Link aria-current={pathname === "/launch" ? "page" : undefined} href="/launch">Launchpad</Link>
      <Link aria-current={pathname === "/docs" ? "page" : undefined} href="/docs">Docs</Link>
    </nav>
    <div className={styles.headerRight}>
      <span className={styles.devnet}><i />DEVNET</span>
      <button className={styles.connect} disabled={connecting} onClick={() => void connect()} title={error ?? undefined} type="button">
        {connecting ? "Connecting…" : address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Connect wallet"}
        <span aria-hidden="true">↗</span>
      </button>
    </div>
    {error && <span className={styles.walletError} role="alert">{error}</span>}
  </header>;
}
