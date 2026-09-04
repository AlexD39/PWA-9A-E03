import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const page = await readFile(resolve(root, "src/app/page.tsx"), "utf8");
const inspectionsSource = await readFile(
  resolve(root, "src/lib/data/inspections.ts"),
  "utf8"
);

// Compila el módulo de datos en memoria para probar los valores que usa la app.
// TypeScript ya es una dependencia del proyecto, por lo que no hace falta otro runner.
const inspectionsModule = ts.transpileModule(inspectionsSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(inspectionsModule).toString("base64")}`;
const { inspections } = await import(moduleUrl);

assert.equal(packageJson.scripts.build, "next build", "El script build debe ejecutar Next.js");
assert.equal(
  packageJson.scripts.test,
  "node tests/starter.spec.mjs",
  "El proyecto debe exponer una suite de pruebas ejecutable"
);

assert.match(page, /Inspecciones de laboratorio/);
assert.match(page, /sintéticos/i);
assert.match(page, /inspections\.map\(/, "La página debe renderizar la colección de inspecciones");
assert.match(page, /inspections\.length/, "El contador debe calcularse a partir de los datos");
assert.match(page, /key=\{inspection\.id\}/, "Cada tarjeta debe tener una clave estable");
assert.match(page, /aria-labelledby="inspections-heading"/, "La sección debe tener un nombre accesible");

assert.ok(Array.isArray(inspections), "Las inspecciones deben almacenarse en una colección");
assert.equal(inspections.length, 3, "El starter debe incluir tres inspecciones sintéticas");

const requiredTextFields = ["id", "location", "date", "inspector", "status", "statusLabel", "summary"];
const allowedStatuses = new Set(["ok", "attention"]);
const ids = new Set();

for (const inspection of inspections) {
  for (const field of requiredTextFields) {
    assert.equal(
      typeof inspection[field],
      "string",
      `${inspection.id ?? "Inspección sin id"}: ${field} debe ser texto`
    );
    assert.ok(
      inspection[field].trim().length > 0,
      `${inspection.id ?? "Inspección sin id"}: ${field} no debe estar vacío`
    );
  }

  assert.ok(!ids.has(inspection.id), `El id ${inspection.id} está duplicado`);
  ids.add(inspection.id);

  assert.match(inspection.date, /^\d{4}-\d{2}-\d{2}$/, `${inspection.id}: fecha inválida`);
  assert.equal(
    new Date(`${inspection.date}T00:00:00Z`).toISOString().slice(0, 10),
    inspection.date,
    `${inspection.id}: la fecha no existe en el calendario`
  );
  assert.ok(allowedStatuses.has(inspection.status), `${inspection.id}: estado no permitido`);
  assert.ok(Number.isInteger(inspection.findings), `${inspection.id}: findings debe ser un entero`);
  assert.ok(inspection.findings >= 0, `${inspection.id}: findings no puede ser negativo`);

  if (inspection.status === "ok") {
    assert.equal(inspection.findings, 0, `${inspection.id}: una inspección ok no debe tener hallazgos`);
  } else {
    assert.ok(
      inspection.findings > 0,
      `${inspection.id}: una inspección con atención debe tener hallazgos`
    );
  }
}

assert.deepEqual(
  new Set(inspections.map(({ status }) => status)),
  allowedStatuses,
  "Los datos de demostración deben cubrir ambos estados"
);

console.log(`starter.spec.mjs: PASS (${inspections.length} inspecciones verificadas)`);
