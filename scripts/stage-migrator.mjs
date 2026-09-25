import { copyFile, cp, mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const stage = await mkdtemp(path.join(os.tmpdir(), "cmx-migrator-"));
await Promise.all([
  copyFile(path.join(root, "worker", "package.json"), path.join(stage, "package.json")),
  copyFile(path.join(root, "worker", "package-lock.json"), path.join(stage, "package-lock.json")),
  copyFile(path.join(root, "Dockerfile.migrator"), path.join(stage, "Dockerfile")),
  mkdir(path.join(stage, "scripts")),
]);
await Promise.all([
  copyFile(path.join(root, "scripts", "auto-migrate.mjs"), path.join(stage, "scripts", "auto-migrate.mjs")),
  copyFile(path.join(root, "scripts", "auto-migrate-core.mjs"), path.join(stage, "scripts", "auto-migrate-core.mjs")),
  cp(path.join(root, "deployment"), path.join(stage, "deployment"), { recursive: true }),
]);
console.log(stage);
