"use client";

import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export type WalletKind = "phantom" | "metamask";

type SolanaTransaction = Transaction | VersionedTransaction;
export type SolanaWallet = {
  publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  signTransaction<T extends SolanaTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends SolanaTransaction>(transactions: T[]): Promise<T[]>;
};

type PhantomProvider = SolanaWallet & {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
};

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  }
}

let connectedWallet: SolanaWallet | null = null;

export function activeWallet(): SolanaWallet {
  if (!connectedWallet) throw new Error("Connect a Solana wallet first.");
  return connectedWallet;
}

export async function connectSolanaWallet(kind: WalletKind): Promise<PublicKey> {
  if (kind === "phantom") {
    const provider = window.phantom?.solana ?? window.solana;
    if (!provider?.isPhantom) throw new Error("Phantom is not installed. Add the browser extension, then try again.");
    const { publicKey } = await provider.connect();
    connectedWallet = {
      publicKey,
      signMessage: (message) => provider.signMessage(message, "utf8"),
      signTransaction: (transaction) => provider.signTransaction(transaction),
      signAllTransactions: (transactions) => provider.signAllTransactions(transactions),
    };
    return publicKey;
  }

  const { createSolanaClient } = await import("@metamask/connect-solana");
  const client = await createSolanaClient({
    dapp: {
      name: "CX Compute Exchange",
      url: window.location.origin,
      iconUrl: `${window.location.origin}/brand/cx-emblem.png`,
    },
    api: { supportedNetworks: { devnet: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com" } },
  });
  const wallet = client.getWallet();
  const features = wallet.features as unknown as {
    "standard:connect": { connect(): Promise<{ accounts: Array<{ address: string }> }> };
    "solana:signTransaction": { signTransaction(input: { account: { address: string }; transaction: Uint8Array; chain: string }): Promise<Array<{ signedTransaction: Uint8Array }>> };
    "solana:signMessage": { signMessage(input: { account: { address: string }; message: Uint8Array }): Promise<Array<{ signature: Uint8Array }>> };
  };
  const { accounts } = await features["standard:connect"].connect();
  const account = accounts[0];
  if (!account) throw new Error("MetaMask did not return a Solana account.");
  const publicKey = new PublicKey(account.address);
  const chain = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

  async function signTransaction<T extends SolanaTransaction>(transaction: T): Promise<T> {
    const bytes = transaction instanceof Transaction
      ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
      : transaction.serialize();
    const [result] = await features["solana:signTransaction"].signTransaction({
      account,
      transaction: bytes,
      chain,
    });
    if (!result) throw new Error("MetaMask did not sign the transaction.");
    return (transaction instanceof Transaction
      ? Transaction.from(result.signedTransaction)
      : VersionedTransaction.deserialize(result.signedTransaction)) as T;
  }

  connectedWallet = {
    publicKey,
    signMessage: async (message) => {
      const [result] = await features["solana:signMessage"].signMessage({ account, message });
      if (!result) throw new Error("MetaMask did not sign the message.");
      return { signature: result.signature };
    },
    signTransaction,
    signAllTransactions: async <T extends SolanaTransaction>(transactions: T[]) => {
      const signed: T[] = [];
      for (const transaction of transactions) signed.push(await signTransaction(transaction));
      return signed;
    },
  };
  return publicKey;
}
