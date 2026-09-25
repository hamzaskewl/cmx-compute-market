"use client";

import Image from "next/image";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { connectWallet } from "@/lib/chain-client";
import type { WalletKind } from "@/lib/solana-wallet";
import styles from "./wallet-context.module.css";

type WalletContextValue = {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<string | null>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<((address: string | null) => void) | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (chooserOpen) firstOptionRef.current?.focus();
  }, [chooserOpen]);

  const close = () => {
    setChooserOpen(false);
    resolveRef.current?.(null);
    resolveRef.current = null;
  };

  const connect = () => {
    if (resolveRef.current || connecting) return Promise.resolve(null);
    setError(null);
    setChooserOpen(true);
    return new Promise<string | null>((resolve) => { resolveRef.current = resolve; });
  };

  const select = async (kind: WalletKind) => {
    setChooserOpen(false);
    setConnecting(true);
    setError(null);
    try {
      const next = (await connectWallet(kind)).toBase58();
      setAddress(next);
      resolveRef.current?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      resolveRef.current?.(null);
    } finally {
      resolveRef.current = null;
      setConnecting(false);
    }
  };

  return <WalletContext.Provider value={{ address, connecting, error, connect }}>
    {children}
    {chooserOpen && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div aria-labelledby="wallet-title" aria-modal="true" className={styles.dialog} onKeyDown={(event) => { if (event.key === "Escape") close(); }} role="dialog">
        <div className={styles.heading}><div><span>SOLANA DEVNET</span><h2 id="wallet-title">Choose a wallet</h2></div><button aria-label="Close wallet chooser" className={styles.close} onClick={close} type="button">×</button></div>
        <p>Connect a Solana wallet to mint cmB200 or launch a market.</p>
        <button className={styles.option} onClick={() => void select("phantom")} ref={firstOptionRef} type="button"><Image alt="" height={42} src="/brand/phantom.svg" width={42} /><span><strong>Phantom</strong><small>Solana wallet</small></span><span aria-hidden="true">↗</span></button>
        <button className={styles.option} onClick={() => void select("metamask")} type="button"><Image alt="" height={42} src="/brand/metamask.svg" width={42} /><span><strong>MetaMask</strong><small>Solana · desktop extension</small></span><span aria-hidden="true">↗</span></button>
        <div className={styles.help}>Need a wallet? <a href="https://phantom.com/download" rel="noreferrer" target="_blank">Get Phantom</a> <span>or</span> <a href="https://metamask.io/download" rel="noreferrer" target="_blank">get MetaMask</a>.</div>
        <small className={styles.networkNote}>MetaMask supports Solana devnet in its browser extension. Mobile MetaMask currently supports Solana mainnet only.</small>
      </div>
    </div>}
  </WalletContext.Provider>;
}

export function useWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("WalletProvider is missing.");
  return wallet;
}
