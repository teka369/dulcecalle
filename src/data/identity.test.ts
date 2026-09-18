import { describe, expect, it } from "vitest";
import { asUuid } from "./http/mappers";
import { pwaStorage } from "./backend";
import {
  dexieRouteIdFromParam,
  importMapKey,
  IMPORT_TABLE_ORDER,
  INITIAL_DEBT_IMPORT,
  isDexieNumericId,
  isRemoteUuid,
  resolveImportId,
  uuidWouldBreakDexieRoute,
} from "./identity";

const SAMPLE_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("Fase 6.7 identity compatibility", () => {
  it("PWA storage stays Dexie", () => {
    expect(pwaStorage()).toBe("dexie");
  });

  it("does not coerce a UUID to Number", () => {
    expect(Number(SAMPLE_UUID)).toBeNaN();
    expect(isRemoteUuid(SAMPLE_UUID)).toBe(true);
    expect(isDexieNumericId(SAMPLE_UUID)).toBe(false);
    expect(isDexieNumericId(42)).toBe(true);
    expect(() => asUuid(42, "product.id")).toThrow(/UUID string/);
    expect(() => asUuid(Number(SAMPLE_UUID), "product.id")).toThrow(/UUID/);
  });

  it("Dexie routes Number(params.id) would reject a UUID", () => {
    expect(dexieRouteIdFromParam("7")).toBe(7);
    expect(uuidWouldBreakDexieRoute(SAMPLE_UUID)).toBe(true);
    expect(uuidWouldBreakDexieRoute("7")).toBe(false);
    expect(() => dexieRouteIdFromParam(SAMPLE_UUID)).toThrow(/integer/);
  });

  it("import_id_map resolves Dexie int → UUID without leaking the int to HTTP", () => {
    const map = {
      [importMapKey("products", 3)]: SAMPLE_UUID,
      [importMapKey("customers", 1)]: "11111111-1111-4111-8111-111111111111",
    };
    expect(resolveImportId(map, "products", 3)).toBe(SAMPLE_UUID);
    expect(isRemoteUuid(resolveImportId(map, "customers", 1))).toBe(true);
    expect(() => resolveImportId(map, "sales", 3)).toThrow(/no import mapping/);
  });

  it("FK import order puts catalog before events, sessions before cash moves", () => {
    const i = (t: (typeof IMPORT_TABLE_ORDER)[number]) =>
      IMPORT_TABLE_ORDER.indexOf(t);
    expect(i("products")).toBeLessThan(i("sales"));
    expect(i("customers")).toBeLessThan(i("sales"));
    expect(i("sales")).toBeLessThan(i("sale_lines"));
    expect(i("sales")).toBeLessThan(i("stock_moves"));
    expect(i("cash_sessions")).toBeLessThan(i("cash_moves"));
    expect(i("customers")).toBeLessThan(i("customer_payments"));
    expect(i("customers")).toBeLessThan(i("initial_debts"));
    expect(i("sale_lines")).toBeLessThan(i("sale_return_lines"));
  });

  it("$45.000 InitialDebt maps to initial_debts, never a sale", () => {
    expect(INITIAL_DEBT_IMPORT.table).toBe("initial_debts");
    expect(INITIAL_DEBT_IMPORT.createsSale).toBe(false);
    expect(INITIAL_DEBT_IMPORT.createsCashMove).toBe(false);
    expect(INITIAL_DEBT_IMPORT.createsStockMove).toBe(false);
    expect(INITIAL_DEBT_IMPORT.touchesVentas).toBe(false);
    expect(INITIAL_DEBT_IMPORT.touchesRecibido).toBe(false);
  });
});
