import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDeployer } from "./keypair.mjs";

const root = process.cwd();
const programKeyPath = path.join(root, ".keys", "mainnet-program.json");
const program = await loadDeployer(programKeyPath);
if (program.publicKey.toBase58() !== "7M2BCLQXQpoGu4V8tcfZ4Hheu95kJfwYHyTVhUGhPPA5") {
  throw new Error("Mainnet program keypair does not match the source program ID.");
}
const target = path.join(root, "target", "deploy", "gpu_market-keypair.json");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, await readFile(programKeyPath), { mode: 0o600 });
console.log(JSON.stringify({ programId: program.publicKey.toBase58(), target }));
