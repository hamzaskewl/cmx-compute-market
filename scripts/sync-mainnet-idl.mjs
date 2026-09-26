import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const expectedProgramId = "7M2BCLQXQpoGu4V8tcfZ4Hheu95kJfwYHyTVhUGhPPA5";
const generated = JSON.parse(await readFile(path.join(ROOT, "target", "idl", "gpu_market.json"), "utf8"));
if (generated.address !== expectedProgramId) throw new Error("Built IDL has the wrong mainnet program ID.");
const instructions = new Map(generated.instructions.map((instruction) => [instruction.name, instruction]));
for (const name of ["initialize", "buy_index", "sell_index", "set_authorities"]) {
  if (!instructions.has(name)) throw new Error(`Built IDL is missing ${name}.`);
}
for (const name of ["program", "program_data"]) {
  if (!instructions.get("initialize").accounts.some((account) => account.name === name)) {
    throw new Error(`Built initialize instruction is missing ${name}.`);
  }
}
for (const name of ["buy_index", "sell_index"]) {
  if (!instructions.get(name).accounts.some((account) => account.name === "fee_account")) {
    throw new Error(`Built IDL does not route ${name} fees.`);
  }
}
if (!generated.types.find((entry) => entry.name === "Config")?.type?.fields?.some((field) => field.name === "fee_recipient")) {
  throw new Error("Built config is missing fee_recipient.");
}
const binary = await readFile(path.join(ROOT, "target", "deploy", "gpu_market.so"));
if (binary.length === 0) throw new Error("Built program binary is empty.");
await writeFile(path.join(ROOT, "lib", "gpu_market.mainnet.json"), `${JSON.stringify(generated, null, 2)}\n`);
console.log(JSON.stringify({ programId: expectedProgramId, binaryBytes: binary.length, instructions: generated.instructions.length }));
