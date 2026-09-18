import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { loadDeployer } from "../scripts/keypair.mjs";

const deployment = JSON.parse(await readFile("deployment/devnet.json", "utf8"));
const payer = await loadDeployer(".keys/testnet-deployer.json");
const connection = new Connection(process.env.SOLANA_RPC_URL ?? deployment.rpcUrl, "confirmed");
const pool = new PublicKey(process.env.CMX_LIVE_POOL ?? deployment.dbc.probePool);
const baseUrl = (process.env.CMX_LIVE_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const dbc = new DynamicBondingCurveClient(connection, "confirmed");
const controller = new AbortController();
const events = [];

const response = await fetch(`${baseUrl}/api/markets/${pool.toBase58()}/stream`, {
  headers: { accept: "text/event-stream" },
  signal: controller.signal,
});
assert.equal(response.status, 200, "live stream route must accept the probe pool");
const reader = response.body.getReader();
const decoder = new TextDecoder();

const reading = (async () => {
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = chunk.match(/^event: (.+)$/m)?.[1];
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (event && data) events.push({ event, data: JSON.parse(data) });
    }
  }
})().catch((error) => {
  if (error?.name !== "AbortError") throw error;
});

async function waitFor(predicate, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for a live market event.");
}

await waitFor(() => events.find((event) => event.event === "ready"));
const transaction = await dbc.pool.swap({
  owner: payer.publicKey,
  pool,
  amountIn: new BN(10_000),
  minimumAmountOut: new BN(1),
  swapBaseForQuote: false,
  referralTokenAccount: null,
});
const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
  commitment: "confirmed",
});
const streamed = await waitFor(
  () => events.find((event) => event.event === "trade" && event.data.signature === signature),
  30_000,
);

assert.equal(streamed.data.side, "buy");
assert(streamed.data.priceInPair > 0);
assert(streamed.data.quoteAmount > 0);
const sellAmount = Math.max(1, Math.floor(streamed.data.baseAmount * 1_000_000 * 0.5));
const sellTransaction = await dbc.pool.swap({
  owner: payer.publicKey,
  pool,
  amountIn: new BN(sellAmount.toString()),
  minimumAmountOut: new BN(1),
  swapBaseForQuote: true,
  referralTokenAccount: null,
});
const sellSignature = await sendAndConfirmTransaction(connection, sellTransaction, [payer], {
  commitment: "confirmed",
});
const streamedSell = await waitFor(
  () => events.find((event) => event.event === "trade" && event.data.signature === sellSignature),
  30_000,
);
assert.equal(streamedSell.data.side, "sell");
controller.abort();
await reading;

console.log(JSON.stringify({
  status: "passed",
  pool: pool.toBase58(),
  signature,
  sellSignature,
  streamedTrade: streamed.data,
  streamedSell: streamedSell.data,
}, null, 2));
