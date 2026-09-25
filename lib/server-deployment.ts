import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import type { SolanaCluster } from "@/lib/market-types";

export const NETWORK_COOKIE = "cmx_network";

function configuredNetwork(): SolanaCluster {
  const network = process.env.SOLANA_CLUSTER ?? "devnet";
  if (network !== "devnet" && network !== "mainnet-beta") {
    throw new Error(`Unsupported Solana cluster: ${network}`);
  }
  return network;
}

export async function readSelectedNetwork(): Promise<SolanaCluster> {
  const selected = (await cookies()).get(NETWORK_COOKIE)?.value;
  return selected === "devnet" || selected === "mainnet-beta" ? selected : configuredNetwork();
}

export async function readServerDeployment<T extends { cluster: SolanaCluster }>(network?: SolanaCluster): Promise<T> {
  const cluster = network ?? await readSelectedNetwork();

  const data = await readFile(path.join(process.cwd(), "deployment", `${cluster}.json`), "utf8");
  const deployment = JSON.parse(data) as T;
  if (deployment.cluster !== cluster) {
    throw new Error(`Deployment manifest does not match ${cluster}`);
  }
  return deployment;
}

export async function hasServerDeployment(network?: SolanaCluster): Promise<boolean> {
  try {
    await readServerDeployment(network);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
