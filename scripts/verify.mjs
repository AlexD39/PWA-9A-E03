import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const required = ["package.json", "package-lock.json", "README.md", "src/app/layout.tsx", "src/app/page.tsx", "src/app/globals.css", "src/lib/data/inspections.ts", "docs/requirements.md", "docs/decision-record.md", "tests/starter.spec.mjs", "evidence/individual.md"];
const missing = required.filter(file => !existsSync(resolve(root, file)));
const structureOnly = process.argv.includes("--structure");
if (structureOnly) {
  console.log(missing.length ? `Faltan archivos: ${missing.join(", ")}` : "Estructura presente. No valida contenido, pruebas, build ni secretos.");
  process.exit(missing.length ? 1 : 0);
}
const checks = [{ id: "structure", status: missing.length ? "fail" : "pass", missing }];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const [id, args] of [["test", ["test"]], ["build", ["run", "build"]]]) {
  console.log(`\nVerificando ${id}...`);
  const run = spawnSync(npm, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 20 * 1024 * 1024 });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  checks.push({ id, status: run.status === 0 && !run.error ? "pass" : "fail", exitCode: run.status, error: run.error?.message ?? null });
}
const git = args => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
const documents = ["docs/requirements.md", "docs/decision-record.md", "evidence/individual.md", "README.md"].map(file => ({ file, content: existsSync(resolve(root, file)) ? readFileSync(resolve(root, file), "utf8") : null }));
const gitStatus = git(["status", "--porcelain"]);
const result = {
  schemaVersion: 2,
  checkedAt: new Date().toISOString(),
  commitSha: git(["rev-parse", "HEAD"]),
  workingTreeClean: gitStatus === null ? null : gitStatus === "",
  runtime: { node: process.version },
  status: checks.every(c => c.status === "pass") ? "pass" : "fail",
  checks,
  academicReview: { status: "pending", message: "Sin calificación automática. Revisar requisitos, decisión y evidencia por integrante con la rúbrica; existencia no implica calidad.", documents },
  limits: ["La instalación se verifica mediante npm ci por separado.", "No certifica ausencia de secretos.", "Las pruebas proporcionadas no cubren toda la aplicación."]
};
mkdirSync(resolve(root, "reports"), { recursive: true });
writeFileSync(resolve(root, "reports/verification.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`\nVerificación técnica: ${result.status}. Revisión académica: pendiente. Reporte: reports/verification.json`);
process.exit(result.status === "pass" ? 0 : 1);
