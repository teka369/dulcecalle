import { beforeEach, describe, expect, it, vi } from "vitest";
import { entityBackAction } from "./entity-route";
import { entityViewStore } from "@/store/entityViewStore";

const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("ficha back inside the shell", () => {
  beforeEach(() => {
    entityViewStore.__reset();
    vi.unstubAllGlobals();
  });

  it("closes the overlay when Volver points at the list underneath", () => {
    const assigned: string[] = [];
    vi.stubGlobal("window", { location: { assign: (href: string) => void assigned.push(href) } });
    entityViewStore.open(`/inventario/${PRODUCT}`);
    expect(entityBackAction(true, "/inventario")).toBe("close");
    entityViewStore.close();
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
    expect(assigned).toEqual([]);
  });

  it("pops an action back to the ficha without a document navigation", () => {
    const assigned: string[] = [];
    vi.stubGlobal("window", { location: { assign: (href: string) => void assigned.push(href) } });
    entityViewStore.open(`/inventario/${PRODUCT}`);
    entityViewStore.open(`/inventario/${PRODUCT}/surtir`);
    expect(entityBackAction(true, `/inventario/${PRODUCT}`)).toBe("back");
    entityViewStore.back();
    expect(entityViewStore.getSnapshot().stack).toEqual([
      expect.objectContaining({ kind: "product", action: null }),
    ]);
    expect(assigned).toEqual([]);
  });

  it("keeps a normal Next back when the ficha is a route", () => {
    expect(entityBackAction(false, "/inventario")).toBe("navigate");
    expect(entityBackAction(false, `/inventario/${PRODUCT}`)).toBe("navigate");
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
  });
});
