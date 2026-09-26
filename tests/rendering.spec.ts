export {};

const assert = require("node:assert/strict");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = require("../src/lib/data/inspections-repository");
const routeMod = require("../src/app/api/inspections/[id]/route");
const pageMod = require("../src/app/inspecciones/page");
const { LoadingState } = require("../src/components/loading-state");
const {
  buildInspectionUrl,
  fetchInspectionClient
} = require("../src/lib/rendering/fetch-inspection-client");

async function run() {
  // Repositorio compartido por las rutas SSR y CSR.
  {
    const items = await repo.listInspections({ delayMs: 5 });
    assert.equal(items.length, 3, "debe haber 3 inspecciones sintéticas");
    assert.ok(items[0].id && items[0].location);
  }
  {
    const started = Date.now();
    await repo.listInspections({ delayMs: 60 });
    assert.ok(Date.now() - started >= 55, "delayMs debe ser una espera real, no simulada");
  }
  {
    await assert.rejects(
      repo.listInspections({ delayMs: 1, simulateError: true }),
      /Fallo sintético/
    );
  }
  {
    const found = await repo.getInspectionById("inspection-002", { delayMs: 1 });
    assert.equal(found.location, "Laboratorio de Electrónica");
  }
  {
    const missing = await repo.getInspectionById("no-existe", { delayMs: 1 });
    assert.equal(missing, null, "un id inexistente debe resolver null, no lanzar");
  }

  // Route Handler invocado directamente, sin levantar un servidor Next.js.
  {
    const req = new Request("http://localhost:3000/api/inspections/inspection-001");
    const res = await routeMod.GET(req, { params: { id: "inspection-001" } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.inspection.id, "inspection-001");
  }
  {
    const req = new Request("http://localhost:3000/api/inspections/no-existe");
    const res = await routeMod.GET(req, { params: { id: "no-existe" } });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not-found");
  }
  {
    const req = new Request("http://localhost:3000/api/inspections/inspection-001?fallo=1");
    const res = await routeMod.GET(req, { params: { id: "inspection-001" } });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "server-error");
  }

  // Lógica extraída del componente CSR.
  assert.equal(buildInspectionUrl("inspection-001"), "/api/inspections/inspection-001");
  assert.equal(
    buildInspectionUrl("inspection-001", true),
    "/api/inspections/inspection-001?fallo=1"
  );
  {
    const calls: string[] = [];
    const times = [1000, 1042];
    const mockOk = async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ inspection: { id: "x" } })
      };
    };
    const result = await fetchInspectionClient("inspection-001", {
      fetchImpl: mockOk,
      now: () => times.shift() ?? 1042
    });
    assert.equal(result.status, "ok");
    assert.equal(result.fetchedMs, 42);
    assert.equal(calls[0], "/api/inspections/inspection-001");
  }
  {
    const mock404 = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const result = await fetchInspectionClient("no-existe", { fetchImpl: mock404 });
    assert.equal(result.status, "not-found");
  }
  {
    const mock500 = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const result = await fetchInspectionClient("inspection-001", { fetchImpl: mock500 });
    assert.equal(result.status, "error");
    assert.match(result.message, /HTTP 500/);
  }
  {
    const mockThrow = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await fetchInspectionClient("inspection-001", { fetchImpl: mockThrow });
    assert.equal(result.status, "error");
    assert.match(result.message, /Failed to fetch/);
  }

  // Server Component SSR renderizado como HTML estático en Node.
  {
    const element = await pageMod.default({ searchParams: {} });
    const html = renderToStaticMarkup(element);
    assert.match(html, /Renderizado en el servidor en \d+ ?ms/);
    assert.match(html, /Laboratorio de Redes/);
    assert.match(html, /Laboratorio de Electrónica/);
    assert.match(html, /inspecciones\/inspection-001/);
  }
  {
    await assert.rejects(pageMod.default({ searchParams: { fallo: "1" } }));
  }

  // Estado de carga accesible compartido.
  {
    const html = renderToStaticMarkup(LoadingState({ label: "Probando" }));
    assert.match(html, /Probando/);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /loading-spinner/);
  }

  console.log("rendering.spec.ts: PASS");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
