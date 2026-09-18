import { readFile } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";

export async function loadDeployer(defaultPath) {
  const source = process.env.DEPLOYER_KEYPAIR_JSON
    ? process.env.DEPLOYER_KEYPAIR_JSON
    : await readFile(process.env.DEPLOYER_KEYPAIR ?? defaultPath, "utf8");
  const secret = JSON.parse(source);

  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    secret.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error("DEPLOYER_KEYPAIR_JSON must be a Solana 64-byte secret key JSON array.");
  }

  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
