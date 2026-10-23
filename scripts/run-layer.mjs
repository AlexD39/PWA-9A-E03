/**
 * Compila y ejecuta una o más capas de la pirámide de pruebas (Semana 8).
 *
 *   node scripts/run-layer.mjs unit integration
 *
 * Compila `tests/<capa>/**` con `tsconfig.test.json` (modo estricto, mapas de
 * origen) en `.test-build/` y ejecuta cada archivo `*.test.js` con el corredor
 * de Node (`node --test`). Escribe un reporte JUnit por capa en
 * `reports/junit-<capa>.xml` y muestra el resultado legible en consola.
 *
 * Todas las capas pedidas se ejecutan aunque una falle; el código de salida
 * es distinto de cero si alguna falló. Los E2E no pasan por aquí: usan
 * Playwright (`npm run test:e2e`).
 */

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const tsc = resolve(root, "node_modules", "typescript", "bin", "tsc");
const buildDir = resolve(root, ".test-build");
const reportsDir = resolve(root, "reports");
const known = ["unit", "integration"];
const layers = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (layers.length === 0 || layers.some((layer) => !known.includes(layer))) {
  console.error(`Uso: node scripts/run-layer.mjs <${known.join("|")}>...`);
  process.exit(2);
}

function collect(directory) {
  const found = [];
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) found.push(...collect(full));
    else if (name.endsWith(".test.js")) found.push(full);
  }
  return found.sort();
}

rmSync(buildDir, { recursive: true, force: true });
const compile = spawnSync(process.execPath, [tsc, "-p", "tsconfig.test.json"], { cwd: root, stdio: "inherit" });
if (compile.status !== 0) {
  console.error("La compilación de las pruebas falló.");
  process.exit(compile.status ?? 1);
}

mkdirSync(reportsDir, { recursive: true });
let exitCode = 0;
for (const layer of layers) {
  const files = collect(resolve(buildDir, "tests", layer));
  if (files.length === 0) {
    console.error(`No hay pruebas en la capa "${layer}".`);
    exitCode = 1;
    continue;
  }
  console.log(`\n== Capa ${layer}: ${files.length} archivo(s) ==`);
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=junit",
      `--test-reporter-destination=${resolve(reportsDir, `junit-${layer}.xml`)}`,
      ...files
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (result.status !== 0) exitCode = result.status ?? 1;
}
process.exit(exitCode);
