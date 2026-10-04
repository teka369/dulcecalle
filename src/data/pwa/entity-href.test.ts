import { describe, expect, it } from "vitest";
import { parseEntityHref } from "./entity-href";

const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SALE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("entity href", () => {
  it("parses product, customer, supplier and sale fichas", () => {
    expect(parseEntityHref(`/inventario/${PRODUCT}`)).toMatchObject({ kind: "product", id: PRODUCT, action: null });
    expect(parseEntityHref(`/inventario/${PRODUCT}/surtir`)?.action).toBe("surtir");
    expect(parseEntityHref(`/inventario/${PRODUCT}/preparar`)?.action).toBe("preparar");
    expect(parseEntityHref(`/inventario/${PRODUCT}/me-lo-comi`)?.action).toBe("me-lo-comi");
    expect(parseEntityHref(`/inventario/${PRODUCT}/regalo`)?.action).toBe("regalo");
    expect(parseEntityHref(`/inventario/${PRODUCT}/perdido`)?.action).toBe("perdido");
    expect(parseEntityHref(`/clientes/${CUSTOMER}`)).toMatchObject({ kind: "customer", action: null });
    expect(parseEntityHref(`/clientes/${CUSTOMER}/abono`)?.action).toBe("abono");
    expect(parseEntityHref(`/clientes/${CUSTOMER}/deuda-inicial`)?.action).toBe("deuda-inicial");
    expect(parseEntityHref(`/inventario/proveedores/${SUPPLIER}`)).toMatchObject({ kind: "supplier", action: null });
    expect(parseEntityHref(`/ventas/${SALE}`)).toMatchObject({ kind: "sale", action: null });
    expect(parseEntityHref(`/ventas/${SALE}/devolver`)?.action).toBe("devolver");
  });

  it("does not treat static screens or unknown ids as fichas", () => {
    expect(parseEntityHref("/inventario")).toBeNull();
    expect(parseEntityHref("/inventario/nuevo")).toBeNull();
    expect(parseEntityHref("/inventario/proveedores/nuevo")).toBeNull();
    expect(parseEntityHref("/clientes/nuevo")).toBeNull();
    expect(parseEntityHref("/ventas/nueva")).toBeNull();
    expect(parseEntityHref("/ventas/cobrar")).toBeNull();
    expect(parseEntityHref("/ventas/1")).toBeNull();
    expect(parseEntityHref("/mas/caja")).toBeNull();
  });
});
