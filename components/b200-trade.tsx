"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/components/wallet-context";
import b200Plate from "@/assets/plates/gpu-b200.png";
import { balances, claimTestUsdc, loadDeployment, protocolStats, tradeIndex, verifyDeployment, type Deployment, type ProtocolStats, type WalletBalances } from "@/lib/chain-client";
import styles from "@/app/page.module.css";

const empty: WalletBalances = { sol: 0, quote: 0, token: 0 };

export function B200Trade() {
  const { address, connect, error: walletError } = useWallet();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [walletBalances, setWalletBalances] = useState(empty);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadDeployment().then(async (next) => {
      const verification = await verifyDeployment(next);
      if (active) { setDeployment(next); setReady(verification.executable); }
    }).catch((error: unknown) => { if (active) setNotice(error instanceof Error ? error.message : "Market unavailable."); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!deployment || !address) return;
    const [nextBalances, nextStats] = await Promise.all([balances(deployment, "B200"), protocolStats(deployment, "B200")]);
    setWalletBalances(nextBalances);
    setStats(nextStats);
  }, [address, deployment]);

  useEffect(() => {
    if (!deployment || !address) return;
    Promise.all([balances(deployment, "B200"), protocolStats(deployment, "B200")])
      .then(([nextBalances, nextStats]) => { setWalletBalances(nextBalances); setStats(nextStats); })
      .catch(() => setNotice("Could not load wallet balances."));
  }, [address, deployment]);

  const perform = async (action: "trade" | "faucet") => {
    if (!deployment || !address) return;
    setBusy(true); setSignature(null); setNotice("");
    try {
      if (action === "faucet") {
        setSignature(await claimTestUsdc(deployment));
        setNotice("Test USDC claimed. You can now mint cmB200.");
      } else {
        const onchain = deployment.indices.find((entry) => entry.symbol === "B200")?.price;
        if (!onchain) throw new Error("B200 price is unavailable onchain.");
        setSignature(await tradeIndex(deployment, "B200", mode, Number(amount), onchain));
        setNotice(mode === "buy" ? "cmB200 minted." : "cmB200 redeemed.");
        setAmount("");
      }
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Transaction failed."); }
    finally { setBusy(false); }
  };

  return <section className={styles.trade} id="trade" aria-label="Trade B200">
    <div className={styles.tradeHead}><div><span className={styles.sectionIndex}>01 / THE ASSET</span><h2>Get exposure to<br/><em>real compute.</em></h2></div><p>Mint cmB200 against the B200 GPU-hour reference. Use it to launch and trade markets paired with compute.</p></div>
    <div className={styles.tradeGrid}>
      <div className={styles.gpuVisual}>
        <div className={styles.gpuVisualTop}><span>NVIDIA B200</span><span>BLACKWELL / 180GB HBM3E</span></div>
        <Image src={b200Plate} alt="Existing pixel illustration of the NVIDIA B200" fill sizes="(max-width: 1050px) 100vw, 58vw" />
        <div className={styles.gpuVisualBottom}><strong>B200</strong><span>Compute has a price.<br/>Now it has a market.</span></div>
      </div>
      <div className={styles.tradeCard}>
        <div className={styles.tradeCardTop}><div><span className={styles.sectionIndex}>cmB200 / DEVNET</span><h3>Mint & redeem</h3></div><span className={styles.availability}><i />{ready ? "LIVE ON DEVNET" : "LOADING"}</span></div>
        <div className={styles.modeTabs}><button aria-pressed={mode === "buy"} onClick={() => setMode("buy")} type="button">Mint</button><button aria-pressed={mode === "sell"} onClick={() => setMode("sell")} type="button">Redeem</button></div>
        <label className={styles.amountField}><span>{mode === "buy" ? "You pay" : "You redeem"}<small>Balance: {mode === "buy" ? walletBalances.quote.toFixed(2) : walletBalances.token.toFixed(4)}</small></span><div><input inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} placeholder="0.00" step="any" type="number" value={amount} /><strong>{mode === "buy" ? "test USDC" : "cmB200"}</strong></div></label>
        <div className={styles.quoteLine}><span>Reference</span><strong>{stats ? `$${stats.onchainPrice.toFixed(4)} / GPU-hour` : "Connect for quote"}</strong></div>
        <div className={styles.quoteLine}><span>Reserve</span><strong>{stats ? `${stats.reserve.toFixed(2)} test USDC` : "—"}</strong></div>
        <button className={styles.tradeAction} disabled={busy || !ready || (address !== null && (!amount || Number(amount) <= 0))} onClick={() => address ? void perform("trade") : void connect()} type="button"><span>{busy ? "Confirming…" : !address ? "Connect wallet to start" : mode === "buy" ? "Mint cmB200" : "Redeem cmB200"}</span><span className={styles.actionIcon} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M4 16L16 4M6 4h10v10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" strokeLinejoin="miter" /></svg></span></button>
        {deployment?.cluster === "devnet" && <button className={styles.faucet} disabled={!address || busy} onClick={() => void perform("faucet")} type="button">Need test USDC? Claim from faucet →</button>}
        <p className={styles.tradeDisclaimer}>Devnet uses test assets. Mint and redeem fee: 0.30%. Redemption depends on available reserve liquidity.</p>
        {(notice || walletError) && <p className={styles.notice} role="status">{notice || walletError}{signature && <a href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} rel="noreferrer" target="_blank"> View transaction ↗</a>}</p>}
      </div>
    </div>
  </section>;
}
