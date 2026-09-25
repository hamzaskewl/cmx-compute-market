"use client";

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";
import {
  ActivationType,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DynamicBondingCurveClient,
  SwapMode,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  getCurrentPoint,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { WebUploader } from "@irys/web-upload";
import { WebSolana } from "@irys/web-upload-solana";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import idl from "./gpu_market.json";
import { activeWallet, connectSolanaWallet, type WalletKind } from "./solana-wallet";
import type { DbcMarket } from "./market-types";

export type { DbcMarket, MarketPricePoint, MarketTrade } from "./market-types";

export type DeploymentIndex = {
  symbol: string;
  name: string;
  price: number;
  feed: string;
  mint: string;
  quoteVault: string;
};

export type Deployment = {
  cluster: "devnet" | "mainnet-beta";
  rpcUrl: string;
  programId: string;
  config: string;
  quoteMint: string;
  oracleUpdatedAt: string;
  indices: DeploymentIndex[];
  dbc: {
    programId: string;
    config: string;
    quoteSymbol: "B200";
    quoteMint: string;
    tradingFeeBps: number;
    creatorTradingFeePercentage: number;
    initialMarketCapInQuote: number;
    migrationMarketCapInQuote: number;
    migration: string;
    migratedLiquidity: string;
  };
};

export type WalletBalances = {
  sol: number;
  quote: number;
  token: number;
};

export type ProtocolStats = {
  onchainPrice: number;
  updatedAt: number;
  reserve: number;
  circulating: number;
  totalMinted: number;
  totalRedeemed: number;
  coveragePercent: number | null;
};

const SCALE = 1_000_000;

function clientRpcUrl() {
  return `${window.location.origin}/api/rpc`;
}

function browserConnection() {
  return new Connection(clientRpcUrl(), {
    commitment: "confirmed",
    fetch: async (input, init) => {
      let response = await fetch(input, init);
      for (let attempt = 0; attempt < 2 && response.status === 404; attempt += 1) {
        if (!(await response.clone().text()).includes("Application not found")) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        response = await fetch(input, init);
      }
      return response;
    },
  });
}

export async function connectWallet(kind: WalletKind = "phantom") { return connectSolanaWallet(kind); }

export async function loadDeployment(): Promise<Deployment> {
  const response = await fetch("/api/deployment", { cache: "no-store" });
  if (!response.ok) throw new Error("The Solana market deployment is still loading.");
  return response.json();
}

export async function verifyDeployment(deployment: Deployment) {
  const connection = browserConnection();
  const account = await connection.getAccountInfo(new PublicKey(deployment.programId));
  return { executable: Boolean(account?.executable) };
}

function client(deployment: Deployment) {
  const injected = activeWallet();
  const wallet = {
    publicKey: injected.publicKey,
    signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) =>
      injected.signTransaction(transaction),
    signAllTransactions: <T extends Transaction | VersionedTransaction>(transactions: T[]) =>
      injected.signAllTransactions(transactions),
  };
  const connection = browserConnection();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return {
    connection,
    program: new anchor.Program({ ...idl, address: deployment.programId } as anchor.Idl, provider),
    user: injected.publicKey,
  };
}

async function sendWalletTransaction(
  connection: Connection,
  user: PublicKey,
  transaction: Transaction,
  extraSigners: Keypair[] = [],
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = user;
  transaction.recentBlockhash = latest.blockhash;

  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    if (simulation.value.logs?.some((line) => line.includes("URI too long"))) {
      throw new Error("Token details are too long for Solana. Shorten the description or use a shorter logo URL.");
    }
    const reason = typeof simulation.value.err === "string"
      ? simulation.value.err
      : JSON.stringify(simulation.value.err);
    throw new Error(`Transaction simulation failed before wallet approval: ${reason}`);
  }

  // The wallet should sign first when a transaction has multiple signers. Adding
  // ephemeral signatures before wallet review can prevent safe simulation.
  const signed = await activeWallet().signTransaction(transaction);
  if (extraSigners.length > 0) signed.partialSign(...extraSigners);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    preflightCommitment: "confirmed",
  });
  // The same-origin RPC proxy handles HTTP only. Solana's confirmTransaction
  // waits on WebSocket subscriptions, so poll the confirmed signature instead.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const result = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = result.value[0];
      if (status?.err) throw new Error(`Transaction failed on Solana: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Transaction failed on Solana:")) throw error;
      // A transient Railway edge error should not leave a successful
      // transaction stuck in the interface.
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  throw new Error(`Transaction ${signature} was submitted, but confirmation is taking longer than expected. Check it in Solana Explorer before trying again.`);
}

export async function balances(deployment: Deployment, symbol: string) {
  const { connection, user } = client(deployment);
  const index = deployment.indices.find((item) => item.symbol === symbol);
  if (!index) throw new Error(`$${symbol} is not registered.`);
  const quoteAta = getAssociatedTokenAddressSync(new PublicKey(deployment.quoteMint), user);
  const indexAta = getAssociatedTokenAddressSync(new PublicKey(index.mint), user);
  const read = async (address: PublicKey) => {
    try {
      return Number((await getAccount(connection, address)).amount) / SCALE;
    } catch {
      return 0;
    }
  };
  const [quote, token, lamports] = await Promise.all([
    read(quoteAta),
    read(indexAta),
    connection.getBalance(user),
  ]);
  return { sol: lamports / 1_000_000_000, quote, token } satisfies WalletBalances;
}

export async function protocolStats(deployment: Deployment, symbol: string) {
  const { connection, program } = client(deployment);
  const index = deployment.indices.find((item) => item.symbol === symbol);
  if (!index) throw new Error(`$${symbol} is not registered.`);
  const accounts = program.account as unknown as {
    indexFeed: { fetch(address: PublicKey): Promise<{
      priceMicroUsd: BN;
      updatedAt: BN;
      totalMinted: BN;
      totalRedeemed: BN;
    }> };
  };
  const [feed, vault] = await Promise.all([
    accounts.indexFeed.fetch(new PublicKey(index.feed)),
    getAccount(connection, new PublicKey(index.quoteVault)),
  ]);
  const onchainPrice = Number(feed.priceMicroUsd.toString()) / SCALE;
  const totalMinted = Number(feed.totalMinted.toString()) / SCALE;
  const totalRedeemed = Number(feed.totalRedeemed.toString()) / SCALE;
  const circulating = Math.max(0, totalMinted - totalRedeemed);
  const reserve = Number(vault.amount) / SCALE;
  const liability = circulating * onchainPrice;
  return {
    onchainPrice,
    updatedAt: Number(feed.updatedAt.toString()),
    reserve,
    circulating,
    totalMinted,
    totalRedeemed,
    coveragePercent: liability > 0 ? (reserve / liability) * 100 : null,
  } satisfies ProtocolStats;
}

export async function hasClaimedTestUsdc(deployment: Deployment) {
  if (deployment.cluster !== "devnet") return false;
  const { connection, program, user } = client(deployment);
  const [receipt] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet"), user.toBuffer()],
    program.programId,
  );
  return Boolean(await connection.getAccountInfo(receipt, "confirmed"));
}

export async function testUsdcClaimMinSol(deployment: Deployment) {
  if (deployment.cluster !== "devnet") return 0;
  const { connection, user } = client(deployment);
  const claimed = await hasClaimedTestUsdc(deployment);
  const userQuote = getAssociatedTokenAddressSync(new PublicKey(deployment.quoteMint), user);
  const [receiptRent, ataRent, userAta] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(8 + 32 + 1 + 1),
    connection.getMinimumBalanceForRentExemption(165),
    connection.getAccountInfo(userQuote),
  ]);
  return (receiptRent + (claimed ? ataRent : 0) + (userAta ? 0 : ataRent) + 10_000) / 1_000_000_000;
}

export async function walletSolBalance(deployment: Deployment) {
  const { connection, user } = client(deployment);
  return (await connection.getBalance(user, "confirmed")) / 1_000_000_000;
}

export async function claimTestUsdc(deployment: Deployment) {
  if (deployment.cluster !== "devnet") throw new Error("The test faucet is available only on devnet.");
  const { connection, program, user } = client(deployment);
  const quoteMint = new PublicKey(deployment.quoteMint);
  const userQuote = getAssociatedTokenAddressSync(quoteMint, user);
  const claimed = await hasClaimedTestUsdc(deployment);
  const claimSigner = claimed ? Keypair.generate() : null;
  const claimant = claimSigner?.publicKey ?? user;
  const claimantQuote = getAssociatedTokenAddressSync(quoteMint, claimant);
  const [receipt] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet"), claimant.toBuffer()],
    program.programId,
  );
  const claimTransaction = await program.methods
    .claimTestUsdc()
    .accounts({
      config: new PublicKey(deployment.config),
      quoteMint,
      userQuote: claimantQuote,
      receipt,
      user: claimant,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  if (!claimSigner) return sendWalletTransaction(connection, user, claimTransaction);

  // The deployed devnet program allows one claim per signer. A fresh signer
  // claims the test mint, then transfers the whole amount to the connected
  // wallet in the same transaction. The signer is discarded afterwards.
  const [receiptRent, ataRent, userAta] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(8 + 32 + 1 + 1),
    connection.getMinimumBalanceForRentExemption(165),
    connection.getAccountInfo(userQuote),
  ]);
  const userAtaExists = Boolean(userAta);
  const neededLamports = receiptRent + ataRent + (userAtaExists ? 0 : ataRent) + 10_000;
  if (await connection.getBalance(user) < neededLamports) {
    throw new Error(`Add at least ${(neededLamports / 1_000_000_000).toFixed(4)} devnet SOL to claim test USDC.`);
  }
  const transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: user, toPubkey: claimant, lamports: receiptRent + ataRent }),
    ...claimTransaction.instructions,
  );
  if (!userAtaExists) transaction.add(createAssociatedTokenAccountInstruction(user, userQuote, user, quoteMint));
  transaction.add(
    createTransferInstruction(claimantQuote, userQuote, claimant, 10_000 * SCALE),
    createCloseAccountInstruction(claimantQuote, user, claimant),
  );
  return sendWalletTransaction(connection, user, transaction, [claimSigner]);
}

function rawTokenAmount(amount: number) {
  const scaled = amount * SCALE;
  const raw = Math.round(scaled);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(raw) || raw <= 0 || Math.abs(scaled - raw) > 0.000001) {
    throw new Error("Enter a positive amount with at most six decimal places.");
  }
  return raw;
}

export async function tradeIndex(
  deployment: Deployment,
  symbol: string,
  mode: "buy" | "sell",
  amount: number,
  price: number,
  slippageBps: number = 100,
) {
  const rawAmount = rawTokenAmount(amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error("The B200 price is unavailable.");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error("Enter slippage below 100%.");
  const { connection, program, user } = client(deployment);
  const index = deployment.indices.find((item) => item.symbol === symbol);
  if (!index) throw new Error(`$${symbol} is not registered.`);

  const quoteMint = new PublicKey(deployment.quoteMint);
  const indexMint = new PublicKey(index.mint);
  const userQuote = getAssociatedTokenAddressSync(quoteMint, user);
  const userIndex = getAssociatedTokenAddressSync(indexMint, user);
  const common = {
    config: new PublicKey(deployment.config),
    feed: new PublicKey(index.feed),
    quoteMint,
    indexMint,
    userQuote,
    userIndex,
    quoteVault: new PublicKey(index.quoteVault),
    user,
    tokenProgram: TOKEN_PROGRAM_ID,
  };

  if (mode === "buy") {
    const quoteIn = rawAmount;
    const minimumIndexOut = Math.floor((amount * 0.997 * (1 - slippageBps / 10_000) * SCALE) / price);
    const transaction = await program.methods
      .buyIndex(new BN(quoteIn), new BN(minimumIndexOut))
      .accounts({
        ...common,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    return sendWalletTransaction(connection, user, transaction);
  }

  const indexIn = rawAmount;
  const minimumQuoteOut = Math.floor(amount * price * 0.997 * (1 - slippageBps / 10_000) * SCALE);
  const transaction = await program.methods
    .sellIndex(new BN(indexIn), new BN(minimumQuoteOut))
    .accounts(common)
    .transaction();
  return sendWalletTransaction(connection, user, transaction);
}

export async function createLaunch(
  deployment: Deployment,
  pairSymbol: string,
  name: string,
  ticker: string,
  feePercent: number,
) {
  const cleanName = name.trim().replace(/[^\x20-\x7E]/g, "").slice(0, 32);
  const cleanTicker = ticker
    .trim()
    .replace(/^\$/, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  if (!cleanName || !cleanTicker) throw new Error("Enter a market name and ticker.");
  const feeBps = Math.round(feePercent * 100);
  if (feeBps < 100 || feeBps > 300) throw new Error("Trading fee must be between 1% and 3%.");

  const { connection, program, user } = client(deployment);
  const index = deployment.indices.find((item) => item.symbol === pairSymbol);
  if (!index) throw new Error(`$${pairSymbol} is not registered.`);
  const nonce = new BN(Date.now());
  const nonceBytes = nonce.toArrayLike(Buffer, "le", 8);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), user.toBuffer(), nonceBytes],
    program.programId,
  );
  const [marketMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("market-mint"), market.toBuffer()],
    program.programId,
  );
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("market-token-vault"), market.toBuffer()],
    program.programId,
  );
  const [pairVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("market-pair-vault"), market.toBuffer()],
    program.programId,
  );
  const fixedBytes = (value: string, size: number) => {
    const bytes = Buffer.alloc(size);
    bytes.write(value, "utf8");
    return [...bytes];
  };

  const transaction = await program.methods
    .createMarket(
      nonce,
      fixedBytes(cleanName, 32),
      Buffer.byteLength(cleanName),
      fixedBytes(cleanTicker, 8),
      Buffer.byteLength(cleanTicker),
      feeBps,
    )
    .accounts({
      config: new PublicKey(deployment.config),
      feed: new PublicKey(index.feed),
      pairMint: new PublicKey(index.mint),
      market,
      marketMint,
      tokenVault,
      pairVault,
      creator: user,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  const signature = await sendWalletTransaction(connection, user, transaction);
  return { signature, market: market.toBase58() };
}

export async function createDbcLaunch(
  deployment: Deployment,
  values: { name: string; ticker: string; description: string; website: string; logo: string },
) {
  const cleanName = values.name.trim().replace(/[^\x20-\x7E]/g, "").slice(0, 32);
  const cleanTicker = values.ticker.trim().replace(/^\$/, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
  const cleanDescription = values.description.trim().replace(/[^\x20-\x7E]/g, "").slice(0, 72);
  const cleanWebsite = values.website.trim().slice(0, 120);
  const cleanLogo = values.logo.trim().slice(0, 160);
  if (!cleanName || !cleanTicker) throw new Error("Enter a market name and ticker.");
  for (const [label, value] of [["website", cleanWebsite], ["logo", cleanLogo]] as const) {
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`The ${label} URL is invalid.`);
    }
    if (parsed.protocol !== "https:") throw new Error(`The ${label} URL must use HTTPS.`);
  }

  const { connection, user } = client(deployment);
  const dbc = new DynamicBondingCurveClient(connection, "confirmed");
  const config = new PublicKey(deployment.dbc.config);
  const b200Mint = new PublicKey(deployment.dbc.quoteMint);
  const configState = await dbc.state.getPoolConfig(config);
  if (!configState || !configState.quoteMint.equals(b200Mint)) {
    throw new Error("The cmB200 Meteora configuration is unavailable.");
  }

  const baseMint = Keypair.generate();
  const pool = deriveDbcPoolAddress(b200Mint, baseMint.publicKey, config);
  const metadata = new URL("/m", window.location.origin);
  metadata.searchParams.set("n", cleanName);
  metadata.searchParams.set("s", cleanTicker);
  if (cleanLogo) metadata.searchParams.set("i", cleanLogo);
  if (cleanDescription) metadata.searchParams.set("d", cleanDescription);
  // Metaplex caps its onchain URI at 200 characters. Keep the image and
  // identity, shortening only the optional description when necessary.
  while (metadata.toString().length > 200 && metadata.searchParams.has("d")) {
    const description = metadata.searchParams.get("d")!;
    if (description.length <= 1) metadata.searchParams.delete("d");
    else metadata.searchParams.set("d", description.slice(0, -1));
  }
  if (metadata.toString().length > 200) {
    throw new Error("The logo URL is too long for Solana token metadata. Upload a different image.");
  }

  const createTransaction = await dbc.creator.createPool({
    name: cleanName,
    symbol: cleanTicker,
    uri: metadata.toString(),
    payer: user,
    poolCreator: user,
    config,
    baseMint: baseMint.publicKey,
  });
  const createSignature = await sendWalletTransaction(connection, user, createTransaction, [baseMint]);

  let metadataSignature: string | null = null;
  let metadataWarning: string | null = null;
  try {
    const detailsTransaction = await dbc.creator.createPoolMetadata({
      virtualPool: pool,
      name: cleanName,
      website: cleanWebsite,
      logo: cleanLogo,
      creator: user,
      payer: user,
    });
    metadataSignature = await sendWalletTransaction(connection, user, detailsTransaction);
  } catch {
    metadataWarning = "The market launched, but its extra profile details could not be saved.";
  }
  return {
    pool: pool.toBase58(),
    mint: baseMint.publicKey.toBase58(),
    createSignature,
    metadataSignature,
    metadataWarning,
  };
}

export async function uploadLogoToIrys(deployment: Deployment, file: File) {
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
    throw new Error("Use a PNG, JPEG, or WebP logo.");
  }
  if (file.size > 2 * 1024 * 1024) throw new Error("Logo files must be 2 MB or smaller.");
  const provider = activeWallet();
  const irysProvider = {
    publicKey: provider.publicKey,
    signMessage: async (message: Uint8Array) => (await provider.signMessage(message)).signature,
    sendTransaction: async (transaction: Transaction, connection: Connection) => {
      const signed = await provider.signTransaction(transaction);
      return connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
    },
  };
  const uploader = WebUploader(WebSolana)
    .withProvider(irysProvider)
    .withRpc(clientRpcUrl());
  const irys = await (deployment.cluster === "devnet" ? uploader.devnet() : uploader.mainnet());
  const receipt = await irys.uploadFile(file, {
    tags: [
      { name: "Content-Type", value: file.type },
      { name: "App-Name", value: "CMX-Compute-Market" },
      { name: "Network", value: "Solana" },
    ],
  });
  if (!receipt.id) throw new Error("Irys did not return an image identifier.");
  return `https://gateway.irys.xyz/${receipt.id}`;
}

export async function loadDbcMarkets(detailed = false) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`/api/markets${detailed ? "?detailed=1" : ""}`, { cache: "no-store" });
    if (response.ok) return response.json() as Promise<{ markets: DbcMarket[] }>;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error("Meteora markets are temporarily unavailable.");
}

export async function loadDbcMarket(address: string, fresh = false, summary = false) {
  const params = new URLSearchParams();
  if (fresh) params.set("fresh", "1");
  if (summary) params.set("summary", "1");
  const suffix = params.size ? `?${params}` : "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`/api/markets/${encodeURIComponent(address)}${suffix}`, { cache: "no-store" });
    if (response.ok) return response.json() as Promise<{ market: DbcMarket }>;
    if (response.status === 404) throw new Error("Market not found on this network.");
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw new Error("Market data is syncing. Please retry shortly.");
}

export async function dbcMarketBalances(deployment: Deployment, market: DbcMarket) {
  const { connection, user } = client(deployment);
  const b200Ata = getAssociatedTokenAddressSync(new PublicKey(deployment.dbc.quoteMint), user);
  const marketAta = getAssociatedTokenAddressSync(new PublicKey(market.mint), user);
  const read = async (address: PublicKey) => {
    try {
      return Number((await getAccount(connection, address)).amount) / SCALE;
    } catch {
      return 0;
    }
  };
  const [b200, token, lamports] = await Promise.all([read(b200Ata), read(marketAta), connection.getBalance(user)]);
  return { b200, token, sol: lamports / 1_000_000_000 };
}

export async function tradeDbcMarket(
  deployment: Deployment,
  market: DbcMarket,
  mode: "buy" | "sell",
  amount: number,
  slippageBps: number,
  amountIsOutput = false,
) {
  const rawAmount = rawTokenAmount(amount);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error("Enter slippage below 100%.");
  const { connection, user } = client(deployment);
  const dbc = new DynamicBondingCurveClient(connection, "confirmed");
  const pool = new PublicKey(market.address);
  const virtualPool = await dbc.state.getPool(pool);
  if (!virtualPool) throw new Error("This DBC pool is unavailable.");
  const config = await dbc.state.getPoolConfig(virtualPool.poolState.config);
  if (!config) throw new Error("This DBC configuration is unavailable.");
  const rawInput = new BN(rawAmount);
  const swapBaseForQuote = mode === "sell";
  const swapMode = amountIsOutput ? SwapMode.ExactOut : mode === "buy" ? SwapMode.PartialFill : SwapMode.ExactIn;
  const currentPoint = await getCurrentPoint(
    connection,
    config.activationType as ActivationType,
  );
  const quote = dbc.pool.swapQuote2({
    virtualPool,
    config,
    swapBaseForQuote,
    ...(amountIsOutput ? { swapMode: SwapMode.ExactOut as const, amountOut: rawInput } : { swapMode: swapMode as SwapMode.ExactIn | SwapMode.PartialFill, amountIn: rawInput }),
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  });
  if (amountIsOutput ? !quote.maximumAmountIn?.gt(new BN(0)) : !quote.minimumAmountOut?.gt(new BN(0))) throw new Error("A trade quote is unavailable for this amount.");
  const requiredInput = amountIsOutput ? quote.maximumAmountIn! : rawInput;
  const available = await dbcMarketBalances(deployment, market);
  const inputBalance = mode === "buy" ? available.b200 : available.token;
  if (requiredInput.gt(new BN(Math.floor(inputBalance * SCALE)))) throw new Error(`Not enough ${mode === "buy" ? "cmB200" : market.symbol}. This trade may need up to ${(Number(requiredInput.toString()) / SCALE).toFixed(6)}.`);
  if (available.sol < 0.00001) throw new Error("Add a little SOL for network fees.");
  const transaction = await dbc.pool.swap2({
    owner: user,
    pool,
    ...(amountIsOutput ? { swapMode: SwapMode.ExactOut as const, amountOut: rawInput, maximumAmountIn: quote.maximumAmountIn! } : { swapMode: swapMode as SwapMode.ExactIn | SwapMode.PartialFill, amountIn: rawInput, minimumAmountOut: quote.minimumAmountOut! }),
    swapBaseForQuote,
    referralTokenAccount: null,
  });
  const signature = await sendWalletTransaction(connection, user, transaction);
  return {
    signature,
    estimatedOut: Number(quote.outputAmount.toString()) / SCALE,
    actualInput: Number(quote.includedFeeInputAmount.toString()) / SCALE,
    unusedInput: amountIsOutput ? 0 : Math.max(
      0,
      Number(rawInput.clone().sub(quote.includedFeeInputAmount).toString()) / SCALE,
    ),
  };
}

export async function tradeDammMarket(
  deployment: Deployment,
  market: DbcMarket,
  mode: "buy" | "sell",
  amount: number,
  slippageBps: number,
  amountIsOutput = false,
) {
  if (!market.migrated || !market.graduatedPool) {
    throw new Error("This market has not graduated to DAMM v2.");
  }
  const rawAmount = rawTokenAmount(amount);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error("Enter slippage below 100%.");

  // Load the AMM only when a graduated market is traded; curve markets do not
  // need the larger DAMM SDK in their initial client bundle.
  const { CpAmm, SwapMode: DammSwapMode, getCurrentPoint: getDammCurrentPoint, getTokenProgram } =
    await import("@meteora-ag/cp-amm-sdk");
  const { connection, user } = client(deployment);
  const damm = new CpAmm(connection);
  const pool = new PublicKey(market.graduatedPool);
  const poolState = await damm.fetchPoolState(pool);
  const tokenMint = new PublicKey(market.mint);
  const quoteMint = new PublicKey(deployment.dbc.quoteMint);
  if (!(
    (poolState.tokenAMint.equals(tokenMint) && poolState.tokenBMint.equals(quoteMint)) ||
    (poolState.tokenBMint.equals(tokenMint) && poolState.tokenAMint.equals(quoteMint))
  )) throw new Error("The graduated pool does not match this market pair.");

  const inputTokenMint = mode === "buy" ? quoteMint : tokenMint;
  const outputTokenMint = mode === "buy" ? tokenMint : quoteMint;
  const quote = damm.getQuote2({
    ...(amountIsOutput ? { swapMode: DammSwapMode.ExactOut, amountOut: new BN(rawAmount) } : { swapMode: DammSwapMode.ExactIn, amountIn: new BN(rawAmount) }),
    currentPoint: await getDammCurrentPoint(connection, poolState.activationType as Parameters<typeof getDammCurrentPoint>[1]),
    hasReferral: false,
    inputTokenMint,
    poolState,
    slippage: slippageBps,
    tokenADecimal: 6,
    tokenBDecimal: 6,
  });
  if (amountIsOutput ? !quote.maximumAmountIn?.gt(new BN(0)) : !quote.minimumAmountOut?.gt(new BN(0))) {
    throw new Error("The DAMM v2 pool cannot quote this amount.");
  }
  const requiredInput = amountIsOutput ? quote.maximumAmountIn! : new BN(rawAmount);
  const available = await dbcMarketBalances(deployment, market);
  const inputBalance = mode === "buy" ? available.b200 : available.token;
  if (requiredInput.gt(new BN(Math.floor(inputBalance * SCALE)))) throw new Error(`Not enough ${mode === "buy" ? "cmB200" : market.symbol}. This trade may need up to ${(Number(requiredInput.toString()) / SCALE).toFixed(6)}.`);
  if (available.sol < 0.00001) throw new Error("Add a little SOL for network fees.");
  const transaction = await damm.swap2({
    payer: user,
    pool,
    poolState,
    inputTokenMint,
    outputTokenMint,
    ...(amountIsOutput ? { swapMode: DammSwapMode.ExactOut, amountOut: new BN(rawAmount), maximumAmountIn: quote.maximumAmountIn! } : { swapMode: DammSwapMode.ExactIn, amountIn: new BN(rawAmount), minimumAmountOut: quote.minimumAmountOut! }),
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: getTokenProgram(poolState.tokenAFlag),
    tokenBProgram: getTokenProgram(poolState.tokenBFlag),
    referralTokenAccount: null,
  });
  const signature = await sendWalletTransaction(connection, user, transaction);
  return {
    signature,
    estimatedOut: Number(quote.outputAmount.toString()) / SCALE,
    actualInput: Number(quote.includedFeeInputAmount.toString()) / SCALE,
    unusedInput: 0,
  };
}

export async function migrateDbcMarket(
  deployment: Deployment,
  market: DbcMarket,
) {
  const { connection, user } = client(deployment);
  const dbc = new DynamicBondingCurveClient(connection, "confirmed");
  const pool = new PublicKey(market.address);
  const virtualPool = await dbc.state.getPool(pool);
  if (!virtualPool) throw new Error("This DBC pool is unavailable.");
  if (virtualPool.poolState.isMigrated) {
    return { signature: null, pool: market.graduatedPool };
  }
  const config = await dbc.state.getPoolConfig(virtualPool.poolState.config);
  if (!config) throw new Error("This DBC configuration is unavailable.");
  if (virtualPool.poolState.quoteReserve.lt(config.migrationQuoteThreshold)) {
    throw new Error("The bonding curve is still accepting buys.");
  }
  const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[Number(config.migrationFeeOption)];
  if (!dammConfig) throw new Error("The DAMM v2 migration configuration is unavailable.");
  const migration = await dbc.migration.migrateToDammV2({
    payer: user,
    pool,
    dammConfig,
  });
  const signature = await sendWalletTransaction(
    connection,
    user,
    migration.transaction,
    [migration.firstPositionNftKeypair, migration.secondPositionNftKeypair],
  );
  return {
    signature,
    pool: deriveDammV2PoolAddress(
      dammConfig,
      virtualPool.poolState.baseMint,
      config.quoteMint,
    ).toBase58(),
  };
}
