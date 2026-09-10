import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const tsc = resolve(root, "node_modules", "typescript", "bin", "tsc");
const temporaryOutput = mkdtempSync(resolve(tmpdir(), "pwa-manifest-tests-"));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  run(process.execPath, [tsc, "--noEmit"]);
  run(process.execPath, [resolve(root, "tests", "starter.spec.mjs")]);
  run(process.execPath, [
    tsc,
    "tests/manifest.spec.ts",
    "--module",
    "commonjs",
    "--target",
    "es2020",
    "--outDir",
    temporaryOutput,
    "--skipLibCheck"
  ]);
  run(process.execPath, [resolve(temporaryOutput, "manifest.spec.js")]);
} finally {
  rmSync(temporaryOutput, { recursive: true, force: true });
}
