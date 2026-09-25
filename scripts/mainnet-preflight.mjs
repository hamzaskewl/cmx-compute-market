import { getMint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const ROOT = process.cwd();
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const programId = new PublicKey("7M2BCLQXQpoGu4V8tcfZ4Hheu95kJfwYHyTVhUGhPPA5");
const publicRpc = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const privateRpcUrl = process.env.SOLANA_MAINNET_RPC_URL;
const rpc = privateRpcUrl ? new Connection(privateRpcUrl, "confirmed") : publicRpc;
const deployer = await loadDeployer(path.join(ROOT, ".keys", "mainnet-deployer.json"));
const programKey = await loadDeployer(path.join(ROOT, ".keys", "mainnet-program.json"));
if (!programKey.publicKey.equals(programId)) throw new Error("Local program keypair does not match the mainnet program ID.");
if (await rpc.getGenesisHash() !== MAINNET_GENESIS) throw new Error("RPC is not Solana mainnet.");
const mint = await getMint(rpc, USDC);
if (mint.decimals !== 6) throw new Error("Official Solana USDC mint has unexpected decimals.");

let binaryBytes;
let estimatedFromDevnet = false;
try {
  binaryBytes = (await readFile(path.join(ROOT, "target", "deploy", "gpu_market.so"))).length;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const devnet = new Connection("https://api.devnet.solana.com", "confirmed");
  const oldProgram = await devnet.getAccountInfo(new PublicKey("BhgV3HcxzK9aUnhcfyez96ctBhESzvZXuE6A3x8LhuLG"));
  if (!oldProgram) throw new Error("Cannot estimate binary size from the deployed devnet program.");
  const oldProgramData = await devnet.getAccountInfo(new PublicKey(oldProgram.data.subarray(4, 36)));
  if (!oldProgramData) throw new Error("Cannot read deployed devnet program data.");
  binaryBytes = oldProgramData.data.length - 45;
  estimatedFromDevnet = true;
}
const [programRent, dataRent, bufferRent, balance, deployed] = await Promise.all([
  rpc.getMinimumBalanceForRentExemption(36),
  rpc.getMinimumBalanceForRentExemption(binaryBytes + 45),
  rpc.getMinimumBalanceForRentExemption(binaryBytes + 37),
  rpc.getBalance(deployer.publicKey),
  rpc.getAccountInfo(programId),
]);
const sol = (lamports) => Number((lamports / 1_000_000_000).toFixed(6));
console.log(JSON.stringify({
  cluster: "mainnet-beta",
  deployer: deployer.publicKey.toBase58(),
  programId: programId.toBase58(),
  programDeployed: Boolean(deployed?.executable),
  privateRpcConfigured: Boolean(privateRpcUrl),
  binaryBytes,
  estimatedFromDevnet,
  currentBalanceSol: sol(balance),
  permanentProgramRentSol: sol(programRent + dataRent),
  temporaryUploadBufferSol: sol(bufferRent),
  estimatedPeakSol: sol(programRent + dataRent + bufferRent),
  additionalToSixSol: sol(Math.max(0, 6_000_000_000 - balance)),
}, null, 2));
