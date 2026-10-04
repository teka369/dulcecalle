import { beforeEach, describe, expect, it, vi } from "vitest";
import { onOfflineLinkClick } from "./OfflineLink";
import { entityViewStore } from "@/store/entityViewStore";

const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SALE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function click() {
  const prevented: boolean[] = [];
  return {
    event: {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      button: 0,
      preventDefault: () => {
        prevented.push(true);
      },
    },
    prevented,
  };
}

describe("offline entity navigation", () => {
  beforeEach(() => {
    entityViewStore.__reset();
    vi.unstubAllGlobals();
  });

  it("opens a product ficha from the loaded app without a document navigation", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", { location: { assign: (href: string) => void assigned.push(href) } });
    const { event, prevented } = click();
    onOfflineLinkClick(event, `/inventario/${PRODUCT}`);
    expect(prevented).toEqual([true]);
    expect(assigned).toEqual([]);
    expect(entityViewStore.getSnapshot().stack).toEqual([
      expect.objectContaining({ kind: "product", id: PRODUCT, action: null }),
    ]);
  });

  it("opens customer, supplier and local sale fichas the same way", () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", { location: { assign: () => undefined } });
    onOfflineLinkClick(click().event, `/clientes/${CUSTOMER}`);
    onOfflineLinkClick(click().event, `/inventario/proveedores/${SUPPLIER}`);
    onOfflineLinkClick(click().event, `/ventas/${SALE}`);
    expect(entityViewStore.getSnapshot().stack.map((view) => view.kind)).toEqual([
      "customer",
      "supplier",
      "sale",
    ]);
  });

  it("keeps action routes inside the shell", () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", { location: { assign: () => undefined } });
    onOfflineLinkClick(click().event, `/inventario/${PRODUCT}/surtir`);
    onOfflineLinkClick(click().event, `/clientes/${CUSTOMER}/abono`);
    expect(entityViewStore.getSnapshot().stack.map((view) => view.action)).toEqual([
      "surtir",
      "abono",
    ]);
  });

  it("still document-navigates a prepared static route", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", { location: { assign: (href: string) => void assigned.push(href) } });
    onOfflineLinkClick(click().event, "/ventas/nueva");
    expect(assigned).toEqual(["/ventas/nueva"]);
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
  });

  it("leaves online clicks to Next", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("window", { location: { assign: (href: string) => void assigned.push(href) } });
    const { event, prevented } = click();
    onOfflineLinkClick(event, `/inventario/${PRODUCT}`);
    expect(prevented).toEqual([]);
    expect(assigned).toEqual([]);
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
  });

  it("does not invent a ficha for a non-entity path", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const assigned: string[] = [];
    vi.stubGlobal("window", { location: { assign: (href: string) => void assigned.push(href) } });
    onOfflineLinkClick(click().event, "/inventario/abc123");
    expect(assigned).toEqual(["/inventario/abc123"]);
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
  });
});
