"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { SolanaCluster } from "@/lib/market-types";

type NetworkContextValue = {
  network: SolanaCluster;
  available: boolean;
  changing: boolean;
  error: string | null;
  selectNetwork: (network: SolanaCluster) => Promise<void>;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children, initialNetwork, initialAvailable }: {
  children: ReactNode;
  initialNetwork: SolanaCluster;
  initialAvailable: boolean;
}) {
  const [network, setNetwork] = useState(initialNetwork);
  const [available, setAvailable] = useState(initialAvailable);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectNetwork(next: SolanaCluster) {
    if (next === network || changing) return;
    setChanging(true);
    setError(null);
    try {
      const response = await fetch("/api/network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: next }),
      });
      if (!response.ok) throw new Error("Could not change networks. Try again.");
      const result = await response.json() as { network: SolanaCluster; available: boolean };
      setNetwork(result.network);
      setAvailable(result.available);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change networks. Try again.");
      setChanging(false);
    }
  }

  return <NetworkContext.Provider value={{ network, available, changing, error, selectNetwork }}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) throw new Error("NetworkProvider is missing.");
  return context;
}
