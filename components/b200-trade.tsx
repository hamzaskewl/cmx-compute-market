"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/components/wallet-context";
import { useNetwork } from "@/components/network-context";
import b200Plate from "@/assets/plates/gpu-b200.png";
import { balances, claimTestUsdc, loadDeployment, protocolStats, testUsdcClaimMinSol, tradeIndex, verifyDeployment, type Deployment, type ProtocolStats, type WalletBalances } from "@/lib/chain-client";
import { maxTokenAmount, slippageIssue, tokenAmountIssue } from "@/lib/transaction-constraints";
import styles from "@/app/page.module.css";

const empty: WalletBalances = { sol: 0, quote: 0, token: 0 };

export function B200Trade() {
  const { address, connect, error: walletError } = useWallet();
  const { network } = useNetwork();
  const isDevnet = network === "devnet";
  const quoteLabel = isDevnet ? "test USDC" : "USDC";
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [walletBalances, setWalletBalances] = useState(empty);
  const [balancesReady, setBalancesReady] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [faucetMinSol, setFaucetMinSol] = useState<number | null>(null);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const enteredAmount = Number(amount);
  const estimatedReceive = stats && stats.onchainPrice > 0 && Number.isFinite(enteredAmount) && enteredAmount > 0
    ? mode === "buy" ? enteredAmount * 0.997 / stats.onchainPrice : enteredAmount * stats.onchainPrice * 0.997
    : null;
  const inputAsset = mode === "buy" ? quoteLabel : "cmB200";
  const available = address && balancesReady ? (mode === "buy" ? walletBalances.quote : walletBalances.token) : null;
  const amountProblem = address ? tokenAmountIssue(amount, available, inputAsset) : null;
  const reserveProblem = mode === "sell" && stats && Number.isFinite(enteredAmount)
    && enteredAmount * stats.onchainPrice > stats.reserve + 0.000001
    ? `The reserve has ${stats.reserve.toFixed(2)} ${quoteLabel}. Redeem a smaller amount.`
    : null;
  const tradeProblem = address
    ? balanceError || amountProblem || slippageIssue(slippage)
      || (!stats || stats.onchainPrice <= 0 ? "B200 price is loading. Try again shortly." : null)
      || (balancesReady && walletBalances.sol < 0.00001 ? "Add a little SOL for network fees." : null)
      || reserveProblem
    : null;

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
    setBalancesReady(true);
    setBalanceError("");
    if (isDevnet) void testUsdcClaimMinSol(deployment).then(setFaucetMinSol).catch(() => setFaucetMinSol(null));
  }, [address, deployment, isDevnet]);

  useEffect(() => {
    if (!deployment || !address) return;
    let active = true;
    // The account may have changed; old balances must not authorize a new trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBalancesReady(false);
    setBalanceError("");
    void Promise.all([balances(deployment, "B200"), protocolStats(deployment, "B200")])
      .then(([nextBalances, nextStats]) => {
        if (!active) return;
        setWalletBalances(nextBalances); setStats(nextStats); setBalancesReady(true);
      })
      .catch(() => { if (active) setBalanceError("Could not check your balance. Reconnect or refresh the page."); });
    if (isDevnet) void testUsdcClaimMinSol(deployment).then((cost) => { if (active) setFaucetMinSol(cost); }).catch(() => { if (active) setFaucetMinSol(null); });
    return () => { active = false; };
  }, [address, deployment, isDevnet]);

  const perform = async (action: "trade" | "faucet") => {
    if (!deployment || !address) return;
    setBusy(true); setSignature(null); setNotice("");
    try {
      if (action === "faucet") {
        setSignature(await claimTestUsdc(deployment));
        setNotice("Test USDC claimed. You can now mint cmB200.");
      } else {
        const [currentBalances, currentStats] = await Promise.all([balances(deployment, "B200"), protocolStats(deployment, "B200")]);
        setWalletBalances(currentBalances);
        setStats(currentStats);
        const currentInput = mode === "buy" ? currentBalances.quote : currentBalances.token;
        const currentProblem = tokenAmountIssue(amount, currentInput, inputAsset) || slippageIssue(slippage)
          || (currentBalances.sol < 0.00001 ? "Add a little SOL for network fees." : null);
        if (currentProblem) throw new Error(currentProblem);
        const currentGross = mode === "sell" ? Number(amount) * currentStats.onchainPrice : 0;
        if (mode === "sell" && currentGross > currentStats.reserve + 0.000001) {
          throw new Error(`The reserve has ${currentStats.reserve.toFixed(2)} ${quoteLabel}. Redeem a smaller amount.`);
        }
        setSignature(await tradeIndex(deployment, "B200", mode, Number(amount), currentStats.onchainPrice, Math.round(Number(slippage) * 100)));
        setNotice(mode === "buy" ? "cmB200 minted." : "cmB200 redeemed.");
        setAmount("");
      }
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Transaction failed."); }
    finally { setBusy(false); }
  };

  return <section className={styles.trade} id="trade" aria-label="Trade B200">
    <div className={styles.tradeHead}><div><span className={styles.sectionIndex}>01 / THE ASSET</span><h2>Trade the price<br/><em>of compute.</em></h2></div><p>cmB200 is a token priced from the B200 GPU-hour reference. Mint it with {quoteLabel}, then use it to trade B200 markets.</p></div>
    <div className={styles.tradeGrid}>
      <div className={styles.gpuVisual}>
        <div className={styles.gpuVisualTop}><span>NVIDIA B200</span><span>BLACKWELL / 180GB HBM3E</span></div>
        <Image src={b200Plate} alt="Existing pixel illustration of the NVIDIA B200" fill sizes="(max-width: 1050px) 100vw, 58vw" />
        <div className={styles.gpuVisualBottom}><strong>B200</strong><span>Compute has a price.<br/>Now it has a market.</span></div>
      </div>
      <div className={styles.tradeCard}>
        <div className={styles.tradeCardTop}><div><span className={styles.sectionIndex}>cmB200 / {isDevnet ? "DEVNET" : "MAINNET"}</span><h3>Mint or redeem cmB200</h3></div><span className={styles.availability}><i />{ready ? `LIVE ON ${isDevnet ? "DEVNET" : "MAINNET"}` : "LOADING"}</span></div>
        <div className={styles.modeTabs}><button aria-pressed={mode === "buy"} disabled={busy} onClick={() => { setMode("buy"); setAmount(""); setNotice(""); }} type="button">Mint</button><button aria-pressed={mode === "sell"} disabled={busy} onClick={() => { setMode("sell"); setAmount(""); setNotice(""); }} type="button">Redeem</button></div>
        <p className={styles.tradeModeHelp}>{mode === "buy" ? `Pay ${quoteLabel} to receive cmB200 at the current B200 reference price.` : `Burn cmB200 to receive ${quoteLabel} from the reserve.`}</p>
        <label className={styles.amountField}><span>{mode === "buy" ? "You pay" : "You redeem"}<small>{address ? balancesReady ? `Available: ${available?.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${inputAsset}` : "Checking balance…" : "Connect to see balance"}</small></span><div><input disabled={busy} inputMode="decimal" min="0" onChange={(event) => { setAmount(event.target.value); setNotice(""); }} placeholder="0.00" step="any" type="number" value={amount} /><strong>{inputAsset}</strong></div></label>
        {address && balancesReady && <button className={styles.maxAmount} disabled={busy || !available} onClick={() => setAmount(maxTokenAmount(available ?? 0))} type="button">Use max {inputAsset}</button>}
        <div className={styles.quoteLine}><span>Estimated received</span><strong>{estimatedReceive === null ? stats ? "Enter an amount" : "Connect for estimate" : `${estimatedReceive.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${mode === "buy" ? "cmB200" : quoteLabel}`}</strong></div>
        <div className={styles.quoteLine}><span>Reference</span><strong>{stats ? `$${stats.onchainPrice.toFixed(4)} / GPU-hour` : "Connect for quote"}</strong></div>
        <label className={styles.tradeSlippage}><span>Slippage %</span><input aria-label="Mint and redeem slippage percent" disabled={busy} inputMode="decimal" min="0" onChange={(event) => { setSlippage(event.target.value); setNotice(""); }} step="any" type="number" value={slippage} /></label>
        <div className={styles.quoteLine}><span>Reserve</span><strong>{stats ? `${stats.reserve.toFixed(2)} ${quoteLabel}` : "—"}</strong></div>
        <button className={styles.tradeAction} disabled={busy || !ready || (address !== null && Boolean(tradeProblem))} onClick={() => address ? void perform("trade") : void connect()} type="button"><span>{busy ? "Confirming…" : !address ? "Connect wallet to start" : mode === "buy" ? "Mint cmB200" : "Redeem cmB200"}</span><span className={styles.actionIcon} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M4 16L16 4M6 4h10v10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" strokeLinejoin="miter" /></svg></span></button>
        {address && tradeProblem && <p className={styles.formHint} role="status">{tradeProblem}</p>}
        {deployment?.cluster === "devnet" && <><button className={styles.faucet} disabled={!address || busy || (balancesReady && faucetMinSol !== null && walletBalances.sol < faucetMinSol)} onClick={() => void perform("faucet")} type="button">Need test USDC? Claim 10,000 →</button><p className={styles.faucetNote}>{balancesReady && faucetMinSol !== null && walletBalances.sol < faucetMinSol ? `Add at least ${faucetMinSol.toFixed(4)} devnet SOL for this claim.` : "Repeat claims are available on devnet. Your wallet pays a small test SOL account fee."}</p></>}
        <p className={styles.tradeDisclaimer}>Estimate includes the 0.30% fee. The onchain price may change before you confirm. {isDevnet ? "These are devnet test tokens, not GPU time." : "cmB200 does not grant GPU time."} Redemption depends on the {quoteLabel} reserve.</p>
        {(notice || walletError) && <p className={styles.notice} role="status">{notice || walletError}{signature && <a href={`https://explorer.solana.com/tx/${signature}${isDevnet ? "?cluster=devnet" : ""}`} rel="noreferrer" target="_blank"> View transaction ↗</a>}</p>}
      </div>
    </div>
  </section>;
}
