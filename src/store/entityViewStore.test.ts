import { beforeEach, describe, expect, it, vi } from "vitest";
import { entityViewStore } from "@/store/entityViewStore";

const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("entity overlay online", () => {
  beforeEach(() => {
    entityViewStore.__reset();
    vi.unstubAllGlobals();
  });

  it("closes the overlay when internet returns and does not navigate", () => {
    const assigned: string[] = [];
    const pushed: string[] = [];
    vi.stubGlobal("window", { location: { assign: (href: string) => void assigned.push(href) } });
    entityViewStore.open(`/inventario/${PRODUCT}`);
    entityViewStore.open(`/ventas/${SALE}`);
    entityViewStore.dismissOnOnline();
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
    expect(assigned).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it("does nothing if no ficha is open", () => {
    entityViewStore.dismissOnOnline();
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
  });
});
