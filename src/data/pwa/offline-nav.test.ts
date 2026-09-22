import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOffline, navigateOfflineAware } from "./offline-nav";

describe("offline-aware navigation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses document navigation while offline", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", {
      location: { assign: (href: string) => void assigned.push(href) },
    });
    const pushed: string[] = [];
    navigateOfflineAware({ push: (h) => void pushed.push(h) }, "/ventas/1");
    expect(assigned).toEqual(["/ventas/1"]);
    expect(pushed).toEqual([]);
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
