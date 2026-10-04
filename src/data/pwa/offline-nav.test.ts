import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOffline, navigateOfflineAware } from "./offline-nav";
import { entityViewStore } from "@/store/entityViewStore";

const SALE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("offline-aware navigation", () => {
  beforeEach(() => {
    entityViewStore.__reset();
    vi.unstubAllGlobals();
  });

  it("uses document navigation for a static route while offline", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", {
      location: { assign: (href: string) => void assigned.push(href) },
    });
    const pushed: string[] = [];
    navigateOfflineAware({ push: (h) => void pushed.push(h) }, "/ventas/1");
    expect(assigned).toEqual(["/ventas/1"]);
    expect(pushed).toEqual([]);
    expect(entityViewStore.getSnapshot().stack).toEqual([]);
  });

  it("opens a local sale inside the shell instead of requesting its document", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", {
      location: { assign: (href: string) => void assigned.push(href) },
    });
    const pushed: string[] = [];
    navigateOfflineAware({ push: (h) => void pushed.push(h) }, `/ventas/${SALE}`, { replace: true });
    expect(assigned).toEqual([]);
    expect(pushed).toEqual([]);
    expect(entityViewStore.getSnapshot().stack).toEqual([
      expect.objectContaining({ kind: "sale", id: SALE, action: null }),
    ]);
  });

  it("keeps SPA navigation while online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const assigned: string[] = [];
    vi.stubGlobal("window", {
      location: { assign: (href: string) => void assigned.push(href) },
    });
    const pushed: string[] = [];
    const replaced: string[] = [];
    navigateOfflineAware(
      { push: (h) => void pushed.push(h), replace: (h) => void replaced.push(h) },
      "/clientes",
    );
    navigateOfflineAware(
      { push: (h) => void pushed.push(h), replace: (h) => void replaced.push(h) },
      "/ventas/nueva",
      { replace: true },
    );
    expect(pushed).toEqual(["/clientes"]);
    expect(replaced).toEqual(["/ventas/nueva"]);
  });

  it("reports offline state honestly", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOffline()).toBe(true);
    vi.stubGlobal("navigator", { onLine: true });
    expect(isOffline()).toBe(false);
  });
});
