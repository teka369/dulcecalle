import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_BACKUP_NOTE,
  STORAGE_NOT_A_BACKUP_BUTTON,
  STORAGE_PERSISTENT_LIMIT,
  formatStorageProbeDetail,
  readOriginStorage,
  requestOriginPersistence,
  storageMissingUsageLine,
  storagePercentLine,
  storageProtectionCopy,
  storageQuotaLine,
  storageRequestMessage,
  storageUsageLine,
  storageUsagePercent,
  storageWarning,
  storageWarningLine,
  type OriginStorageProbe,
} from "./origin-storage";

function probe(partial: OriginStorageProbe): OriginStorageProbe {
  return partial;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("origin storage read", () => {
  it("reports a readable navigator.storage", async () => {
    const snapshot = await readOriginStorage(
      probe({
        persisted: async () => false,
        estimate: async () => ({ usage: 124 * 1048576, quota: 2800 * 1048576 }),
      }),
    );
    expect(snapshot.supported).toBe(true);
    expect(snapshot.error).toBeNull();
    expect(snapshot.persistent).toBe(false);
    expect(snapshot.usage).toBe(124 * 1048576);
    expect(snapshot.quota).toBe(2800 * 1048576);
    expect(snapshot.usagePercent).toBeCloseTo(124 / 2800);
    expect(storageUsageLine(snapshot)).toBe("Uso aproximado: 124.0 MB");
    expect(storageQuotaLine(snapshot)).toMatch(/Límite aproximado que el navegador asigna a este sitio/);
    expect(storageQuotaLine(snapshot)).not.toMatch(/espacio libre/i);
  });

  it("records persisted() true without asking persist()", async () => {
    const persist = vi.fn(async () => true);
    const snapshot = await readOriginStorage(
      probe({
        persisted: async () => true,
        estimate: async () => ({ usage: 1, quota: 10 }),
        persist,
      }),
    );
    expect(snapshot.persistent).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(storageProtectionCopy(snapshot).title).toBe("Almacenamiento protegido");
  });

  it("records persisted() false", async () => {
    const snapshot = await readOriginStorage(
      probe({
        persisted: async () => false,
        estimate: async () => ({ usage: 1, quota: 10 }),
      }),
    );
    expect(snapshot.persistent).toBe(false);
    expect(storageProtectionCopy(snapshot).body).toMatch(/puede eliminarlos automáticamente/);
  });

  it("does not invent numbers when the API is missing", async () => {
    const snapshot = await readOriginStorage(null);
    expect(snapshot.supported).toBe(false);
    expect(snapshot.error).toBe("unsupported");
    expect(snapshot.persistent).toBeNull();
    expect(snapshot.usage).toBeNull();
    expect(snapshot.quota).toBeNull();
    expect(snapshot.usagePercent).toBeNull();
    expect(snapshot.warning).toBe(false);
    expect(storageUsageLine(snapshot)).toBeNull();
    expect(storageQuotaLine(snapshot)).toBeNull();
    expect(storagePercentLine(snapshot)).toBeNull();
    expect(storageProtectionCopy(snapshot).body).toMatch(/no permite consultar/);
  });

  it("keeps an honest gap when persisted() throws", async () => {
    const snapshot = await readOriginStorage(
      probe({
        persisted: async () => {
          throw new Error("blocked");
        },
        estimate: async () => ({ usage: 2 * 1048576, quota: 10 * 1048576 }),
      }),
    );
    expect(snapshot.supported).toBe(true);
    expect(snapshot.persistent).toBeNull();
    expect(snapshot.error).toBe("persisted");
    expect(snapshot.usage).toBe(2 * 1048576);
    expect(storageProtectionCopy(snapshot).body).toMatch(/No asumo que estén protegidos/);
    expect(formatStorageProbeDetail(snapshot)).toBe("2.0 MB de 10.0 MB · protección: no se pudo consultar");
  });

  it("reads usage and quota from estimate()", async () => {
    const snapshot = await readOriginStorage(
      probe({
        persisted: async () => false,
        estimate: async () => ({ usage: 5 * 1048576, quota: 20 * 1048576 }),
      }),
    );
    expect(storageUsageLine(snapshot)).toBe("Uso aproximado: 5.0 MB");
    expect(storageQuotaLine(snapshot)).toContain("20.0 MB");
  });

  it("hides numbers when estimate() fails", async () => {
    const snapshot = await readOriginStorage(
      probe({
        persisted: async () => false,
        estimate: async () => {
          throw new Error("quota down");
        },
      }),
    );
    expect(snapshot.error).toBe("estimate");
    expect(snapshot.persistent).toBe(false);
    expect(snapshot.usage).toBeNull();
    expect(snapshot.quota).toBeNull();
    expect(snapshot.usagePercent).toBeNull();
    expect(storageUsageLine(snapshot)).toBeNull();
    expect(storageMissingUsageLine(snapshot)).toMatch(/No muestro una cifra/);
    expect(() => formatStorageProbeDetail(snapshot)).toThrow(/no expone uso de almacenamiento/);
  });

  it("treats a missing or invalid quota as unavailable", async () => {
    const missing = await readOriginStorage(
      probe({
        persisted: async () => false,
        estimate: async () => ({ usage: 4 * 1048576 }),
      }),
    );
    expect(missing.usage).toBe(4 * 1048576);
    expect(missing.quota).toBeNull();
    expect(missing.usagePercent).toBeNull();
    expect(storagePercentLine(missing)).toBeNull();
    expect(storageQuotaLine(missing)).toBeNull();
    expect(formatStorageProbeDetail(missing)).toBe("4.0 MB usados · protección: no");

    const zero = await readOriginStorage(
      probe({
        persisted: async () => false,
        estimate: async () => ({ usage: 4, quota: 0 }),
      }),
    );
    expect(zero.quota).toBeNull();
    expect(zero.usagePercent).toBeNull();
    expect(zero.warning).toBe(false);

    const negative = await readOriginStorage(
      probe({
        persisted: async () => false,
        estimate: async () => ({ usage: -5, quota: 100 }),
      }),
    );
    expect(negative.usage).toBeNull();
    expect(negative.usagePercent).toBeNull();
    expect(storageUsageLine(negative)).toBeNull();
  });

  it("calculates the percent only from finite positive numbers", () => {
    expect(storageUsagePercent(80, 100)).toBe(0.8);
    expect(storageUsagePercent(0, 100)).toBe(0);
    expect(storageUsagePercent(null, 100)).toBeNull();
    expect(storageUsagePercent(10, null)).toBeNull();
    expect(storageUsagePercent(10, 0)).toBeNull();
    expect(storageUsagePercent(Number.NaN, 10)).toBeNull();
    expect(storageUsagePercent(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("warns at 80% of the estimated site limit and not below", () => {
    expect(storageWarning(0.8)).toBe(true);
    expect(storageWarning(0.799)).toBe(false);
    expect(storageWarning(null)).toBe(false);
    const high = {
      supported: true,
      persistent: false,
      usage: 80,
      quota: 100,
      usagePercent: 0.8,
      warning: true,
      error: null,
    };
    expect(storageWarningLine(high)).toMatch(/Queda poco espacio para este sitio/);
    expect(storageWarningLine(high)).toMatch(/no el espacio libre del teléfono/);
    expect(storageWarningLine({ ...high, warning: false, usagePercent: 0.2 })).toBeNull();
  });
});

describe("origin storage request", () => {
  it("persist() true is followed by a fresh persisted() and estimate()", async () => {
    const order: string[] = [];
    const action = await requestOriginPersistence(
      probe({
        persist: async () => {
          order.push("persist");
          return true;
        },
        persisted: async () => {
          order.push("persisted");
          return true;
        },
        estimate: async () => {
          order.push("estimate");
          return { usage: 1, quota: 10 };
        },
      }),
    );
    expect(order).toEqual(["persist", "persisted", "estimate"]);
    expect(action.persistResult).toBe(true);
    expect(action.persistent).toBe(true);
    expect(action.error).toBeNull();
    expect(storageRequestMessage(action)).toMatch(/ha concedido protección/);
  });

  it("persist() false is not an error and does not mean data was deleted", async () => {
    const action = await requestOriginPersistence(
      probe({
        persist: async () => false,
        persisted: async () => false,
        estimate: async () => ({ usage: 1, quota: 10 }),
      }),
    );
    expect(action.persistResult).toBe(false);
    expect(action.error).toBeNull();
    expect(action.persistent).toBe(false);
    expect(action.usage).toBe(1);
    const message = storageRequestMessage(action) ?? "";
    expect(message).toMatch(/no concedió esta protección/);
    expect(message).toMatch(/siguen disponibles/);
    expect(message.toLowerCase()).not.toMatch(/borraron|se perdieron/);
  });

  it("persist() throwing is recoverable and still re-reads", async () => {
    const order: string[] = [];
    const action = await requestOriginPersistence(
      probe({
        persist: async () => {
          order.push("persist");
          throw new Error("denied by browser");
        },
        persisted: async () => {
          order.push("persisted");
          return false;
        },
        estimate: async () => {
          order.push("estimate");
          return { usage: 3, quota: 9 };
        },
      }),
    );
    expect(order).toEqual(["persist", "persisted", "estimate"]);
    expect(action.persistResult).toBeNull();
    expect(action.error).toBe("persist");
    expect(action.usage).toBe(3);
    expect(storageRequestMessage(action)).toMatch(/No se pudo solicitar la protección/);
    expect(storageRequestMessage(action)).toMatch(/No se borró nada/);
  });

  it("uses the global navigator.storage mock and does not call persist on read", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", {
      storage: {
        persisted: async () => true,
        estimate: async () => ({ usage: 8, quota: 16 }),
        persist,
      },
    });
    const snapshot = await readOriginStorage();
    expect(snapshot.persistent).toBe(true);
    expect(snapshot.usage).toBe(8);
    expect(snapshot.quota).toBe(16);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("storage screens stay honest", () => {
  const banned = /100% seguros|nunca se borrarán|tienes backup|protegidos completamente|espacio libre de tu teléfono|copia de seguridad actualizada/i;

  it("copy separates server, device, persistence and backup", () => {
    const falseState = {
      supported: true,
      persistent: false as const,
      usage: 1,
      quota: 2,
      usagePercent: 0.5,
      warning: false,
      error: null,
    };
    const lines = [
      storageProtectionCopy(falseState).title,
      storageProtectionCopy(falseState).body,
      storageProtectionCopy({ ...falseState, persistent: true }).body,
      STORAGE_BACKUP_NOTE,
      STORAGE_NOT_A_BACKUP_BUTTON,
      STORAGE_PERSISTENT_LIMIT,
      storageQuotaLine(falseState) ?? "",
      storagePercentLine(falseState) ?? "",
    ].join("\n");
    expect(lines).toMatch(/automáticamente/);
    expect(STORAGE_BACKUP_NOTE).toMatch(/no es una copia de seguridad/i);
    expect(STORAGE_BACKUP_NOTE).toMatch(/fase posterior/);
    expect(lines).not.toMatch(banned);
  });

  it("the sync screen does not request persistence until the button handler", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/sincronizacion/page.tsx"), "utf8");
    const center = readFileSync(resolve(process.cwd(), "src/components/shell/SyncCenter.tsx"), "utf8");
    const card = readFileSync(resolve(process.cwd(), "src/components/shell/StorageProtectionCard.tsx"), "utf8");
    const summary = readFileSync(resolve(process.cwd(), "src/components/shell/SyncStatusSummary.tsx"), "utf8");
    const prep = readFileSync(resolve(process.cwd(), "src/data/pwa/offline-prep.ts"), "utf8");
    expect(page).toContain("StorageProtectionCard");
    expect(center).toContain("StorageProtectionCard");
    expect(page).not.toMatch(/\.persist\s*\(/);
    expect(center).not.toMatch(/\.persist\s*\(/);
    expect(page).not.toContain("navigator.storage");
    expect(center).not.toContain("navigator.storage");
    const effect = card.slice(card.indexOf("useEffect(() =>"), card.indexOf("async function onProtect"));
    expect(effect).toContain("readOriginStorage()");
    expect(effect).not.toContain("requestOriginPersistence");
    expect(effect).not.toMatch(/\.persist\s*\(/);
    const click = card.slice(card.indexOf("async function onProtect"));
    expect(click).toContain("requestOriginPersistence()");
    expect(click).not.toMatch(/\.persist\s*\(/);
    expect(card).toMatch(/En el servidor/);
    expect(card).toMatch(/Guardado solo aquí/);
    expect(card).toMatch(/Protección del dispositivo/);
    expect(card).toMatch(/Copia de seguridad/);
    expect(`${page}\n${center}\n${card}\n${summary}`).not.toMatch(banned);
    expect(summary).toMatch(/En el servidor/);
    expect(summary).toMatch(/Guardado solo aquí/);
    expect(prep).toContain("readOriginStorage()");
    expect(prep).not.toMatch(/\.persist\s*\(/);
    expect(prep).not.toContain("navigator.storage");
  });

  it("datos no longer says the phone only stores the session", () => {
    const datos = readFileSync(resolve(process.cwd(), "src/app/mas/datos/page.tsx"), "utf8");
    expect(datos.toLowerCase()).not.toContain("solo guarda la sesión");
    expect(datos.toLowerCase()).not.toContain("solamente guarda");
    expect(datos).toMatch(/todavía no se han enviado/);
    expect(datos).toMatch(/copia para trabajar sin conexión/);
    expect(datos).toContain('href="/sincronizacion"');
    expect(datos).toMatch(/Ver almacenamiento de este teléfono/);
    expect(datos).not.toMatch(banned);
  });
});
