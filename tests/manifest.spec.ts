const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = process.cwd();
const manifestPath = resolve(root, "public", "manifest.webmanifest");

assert.equal(existsSync(manifestPath), true, "Debe existir public/manifest.webmanifest");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

assert.equal(manifest.name, "Inspecciones de laboratorio");
assert.equal(manifest.short_name, "Inspecciones");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
for (const size of ["192x192", "512x512"]) {
  const icon = icons.find((candidate: { sizes?: string }) => candidate.sizes === size);
  assert.ok(icon, `El manifest debe declarar un icono ${size}`);
  assert.equal(icon.src.startsWith("/"), true, `La ruta del icono ${size} debe ser pública`);
  assert.equal(
    existsSync(resolve(root, "public", icon.src.slice(1))),
    true,
    `No existe el archivo declarado para el icono ${size}`
  );
}

const layout = readFileSync(resolve(root, "src", "app", "layout.tsx"), "utf8");
assert.match(layout, /manifest:\s*["']\/manifest\.webmanifest["']/);

console.log("manifest.spec.ts: PASS");
