/**
 * Pruebas unitarias de permisos y capacidades del dispositivo (Semana 8).
 *
 * Riesgo cubierto: "permisos del dispositivo". Ninguna prueba depende de una
 * cámara, una ubicación ni un permiso reales: las APIs del navegador se
 * simulan y se afirma que, cuando faltan o se deniegan, el resultado es un
 * estado explícito y utilizable (nunca una excepción), de modo que la captura
 * puede completarse sin la capacidad.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capturePhoto, photoFromFile } from "../../src/lib/device/camera";
import { requestLocation, type GeolocationLike } from "../../src/lib/device/geolocation";
import { createNotifier, getPermissionState, requestPermission } from "../../src/lib/notifications/client";
import type { ChangeNotification } from "../../src/lib/notifications/client";

const notice: ChangeNotification = {
  title: "Aviso sintético",
  body: "Hay un cambio de prueba.",
  tag: "unit-test",
  kind: "info"
};

function geolocationThatFails(code: number): GeolocationLike {
  return { getCurrentPosition: (_success, failure) => failure({ code }) };
}

describe("ubicación: permiso denegado o ausente", () => {
  it("clasifica cada fallo del navegador con un estado y un mensaje que permite continuar", async () => {
    const expected: Array<[number, string]> = [
      [1, "denied"],
      [2, "unavailable"],
      [3, "timeout"]
    ];
    for (const [code, status] of expected) {
      const result = await requestLocation({ geolocation: geolocationThatFails(code) });
      assert.equal(result.status, status);
      if (result.status !== "ok") assert.match(result.message, /continuar sin ella/);
    }
  });

  it("informa que no hay API cuando el navegador no ofrece geolocalización", async () => {
    const result = await requestLocation({ geolocation: null });
    assert.equal(result.status, "unsupported");
  });

  it("no lanza si la API falla de forma inesperada", async () => {
    const throwing: GeolocationLike = {
      getCurrentPosition: () => {
        throw new Error("fallo simulado");
      }
    };
    assert.equal((await requestLocation({ geolocation: throwing })).status, "error");
  });
});

describe("cámara: permiso denegado o ausente", () => {
  it("un permiso denegado se traduce a denied sin lanzar", async () => {
    const result = await capturePhoto({
      mediaDevices: {
        getUserMedia: async () => {
          throw { name: "NotAllowedError" };
        }
      }
    });
    assert.equal(result.status, "denied");
  });

  it("sin API de cámara el resultado es unsupported", async () => {
    assert.equal((await capturePhoto({ mediaDevices: null })).status, "unsupported");
  });

  it("la alternativa por archivo no necesita ningún permiso y valida el tipo", async () => {
    assert.equal((await photoFromFile(null)).status, "cancelled");
    assert.equal((await photoFromFile({ type: "text/plain", size: 10 })).status, "invalid");
  });
});

describe("avisos: sin permiso, el aviso sigue visible dentro de la aplicación", () => {
  it("con el permiso denegado o sin decidir usa el aviso interno y no el del sistema", async () => {
    const expectedReason = { denied: "permission-denied", default: "permission-default" } as const;
    for (const permission of ["denied", "default"] as const) {
      const inApp: ChangeNotification[] = [];
      const system: string[] = [];
      const notifier = createNotifier({
        notification: { permission, requestPermission: async () => permission },
        createNotification: (title) => system.push(title),
        inApp: (item) => inApp.push(item)
      });
      const result = await notifier.notify(notice);

      assert.equal(result.channel, "in-app");
      assert.equal(result.reason, expectedReason[permission]);
      assert.equal(inApp.length, 1);
      assert.deepEqual(system, []);
    }
  });

  it("sin API de notificaciones el aviso interno sigue funcionando", async () => {
    const inApp: ChangeNotification[] = [];
    const notifier = createNotifier({ notification: null, inApp: (item) => inApp.push(item) });
    const result = await notifier.notify(notice);

    assert.equal(result.reason, "unsupported");
    assert.equal(inApp.length, 1);
    assert.equal(getPermissionState({ notification: null }), "unsupported");
  });

  it("nunca vuelve a pedir el permiso si ya hay una decisión", async () => {
    let asked = 0;
    const api = {
      permission: "denied",
      requestPermission: async () => {
        asked += 1;
        return "granted";
      }
    };
    assert.equal(await requestPermission({ notification: api }), "denied");
    assert.equal(asked, 0);
  });
});
