import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SolanaCluster } from "@/lib/market-types";

export async function readServerDeployment<T extends { cluster: SolanaCluster }>(): Promise<T> {
  const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
  if (cluster !== "devnet" && cluster !== "mainnet-beta") {
    throw new Error(`Unsupported Solana cluster: ${cluster}`);
  }

  const data = await readFile(path.join(process.cwd(), "deployment", `${cluster}.json`), "utf8");
  const deployment = JSON.parse(data) as T;
  if (deployment.cluster !== cluster) {
    throw new Error(`Deployment manifest does not match ${cluster}`);
  }
  return deployment;
}
