"use client";

import Image from "next/image";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { connectWallet } from "@/lib/chain-client";
import { useNetwork } from "@/components/network-context";
import { disconnectSolanaWallet, restoreSolanaWallet } from "@/lib/solana-wallet";
import type { WalletKind } from "@/lib/solana-wallet";
import styles from "./wallet-context.module.css";

type WalletContextValue = {
  address: string | null;
  connecting: boolean;
  restoring: boolean;
  error: string | null;
  connect: () => Promise<string | null>;
  manage: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);
const STORAGE_KEY = "cx-wallet-kind-v1";

export function WalletProvider({ children }: { children: ReactNode }) {
  const { network, available } = useNetwork();
  const [address, setAddress] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<((address: string | null) => void) | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (chooserOpen || managerOpen) firstOptionRef.current?.focus();
  }, [chooserOpen, managerOpen]);

  useEffect(() => {
    if (!available) return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== "phantom" && saved !== "metamask") return;
    let active = true;
    // Mark the existing browser session as restoring before the wallet call begins.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestoring(true);
    void restoreSolanaWallet(saved).then((publicKey) => {
      if (!active) return;
      if (publicKey) {
        setAddress(publicKey.toBase58());
        setKind(saved);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [available]);

  const close = () => {
    setChooserOpen(false);
    resolveRef.current?.(null);
    resolveRef.current = null;
  };

  const connect = () => {
    if (!available) return Promise.resolve(null);
    if (resolveRef.current || connecting || restoring) return Promise.resolve(null);
    setError(null);
    setChooserOpen(true);
    return new Promise<string | null>((resolve) => { resolveRef.current = resolve; });
  };

  const disconnect = async () => {
    setManagerOpen(false);
    setAddress(null);
    setKind(null);
    window.localStorage.removeItem(STORAGE_KEY);
    try { await disconnectSolanaWallet(); }
    catch { setError("Wallet permissions could not be revoked. The CX session is disconnected."); }
  };

  const switchWallet = async () => {
    await disconnect();
    setError(null);
    setChooserOpen(true);
  };

  const select = async (kind: WalletKind) => {
    setChooserOpen(false);
    setConnecting(true);
    setError(null);
    try {
      const next = (await connectWallet(kind)).toBase58();
      setAddress(next);
      setKind(kind);
      window.localStorage.setItem(STORAGE_KEY, kind);
      resolveRef.current?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      resolveRef.current?.(null);
    } finally {
      resolveRef.current = null;
      setConnecting(false);
    }
  };

  return <WalletContext.Provider value={{ address, connecting, restoring, error, connect, manage: () => setManagerOpen(true) }}>
    {children}
    {chooserOpen && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div aria-labelledby="wallet-title" aria-modal="true" className={styles.dialog} onKeyDown={(event) => { if (event.key === "Escape") close(); }} role="dialog">
        <div className={styles.heading}><div><span>SOLANA {network === "devnet" ? "DEVNET" : "MAINNET"}</span><h2 id="wallet-title">Choose a wallet</h2></div><button aria-label="Close wallet chooser" className={styles.close} onClick={close} type="button">×</button></div>
        <p>Connect a Solana wallet to mint cmB200 or launch a market.</p>
        <button className={styles.option} onClick={() => void select("phantom")} ref={firstOptionRef} type="button"><Image alt="" height={42} src="/brand/phantom.svg" width={42} /><span><strong>Phantom</strong><small>Solana wallet</small></span><span aria-hidden="true">↗</span></button>
        <button className={styles.option} onClick={() => void select("metamask")} type="button"><Image alt="" height={42} src="/brand/metamask.svg" width={42} /><span><strong>MetaMask</strong><small>Solana · desktop extension</small></span><span aria-hidden="true">↗</span></button>
        <div className={styles.help}>Need a wallet? <a href="https://phantom.com/download" rel="noreferrer" target="_blank">Get Phantom</a> <span>or</span> <a href="https://metamask.io/download" rel="noreferrer" target="_blank">get MetaMask</a>.</div>
        {network === "devnet" && <small className={styles.networkNote}>MetaMask supports Solana devnet in its browser extension. Mobile MetaMask currently supports Solana mainnet only.</small>}
      </div>
    </div>}
    {managerOpen && address && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setManagerOpen(false); }}>
      <div aria-labelledby="wallet-manager-title" aria-modal="true" className={styles.dialog} onKeyDown={(event) => { if (event.key === "Escape") setManagerOpen(false); }} role="dialog">
        <div className={styles.heading}><div><span>SOLANA {network === "devnet" ? "DEVNET" : "MAINNET"}</span><h2 id="wallet-manager-title">Connected wallet</h2></div><button aria-label="Close wallet menu" className={styles.close} onClick={() => setManagerOpen(false)} type="button">×</button></div>
        <p className={styles.connectedAddress}>{kind === "metamask" ? "MetaMask" : "Phantom"}<span>{address}</span></p>
        <button className={styles.option} onClick={() => void switchWallet()} ref={firstOptionRef} type="button"><span><strong>Switch wallet</strong><small>Choose Phantom or MetaMask</small></span><span aria-hidden="true">↗</span></button>
        <button className={styles.option} onClick={() => void disconnect()} type="button"><span><strong>Disconnect</strong><small>Forget this wallet on CX</small></span></button>
      </div>
    </div>}
  </WalletContext.Provider>;
}

export function useWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("WalletProvider is missing.");
  return wallet;
}
