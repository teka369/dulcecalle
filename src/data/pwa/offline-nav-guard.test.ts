import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (e: { destination: { url: string }; cancelable: boolean; preventDefault: () => void }) => void;

describe("offline document navigation guard (tile bounce)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("cancels a competing navigation (reload / back to the list) while the tile navigation is in flight", async () => {
    const listeners: Listener[] = [];
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "http://x.test/mas/caja", assign },
      navigation: { addEventListener: (_: string, f: Listener) => listeners.push(f) },
      addEventListener: vi.fn(),
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    });
    const { offlineDocumentNavigate, __offlineNavTarget } = await import("./offline-nav");
    offlineDocumentNavigate("/mas/caja/aporte");
    expect(assign).toHaveBeenCalledWith("/mas/caja/aporte");
    expect(__offlineNavTarget()).toBe("http://x.test/mas/caja/aporte");

    const fire = (url: string) => {
      const e = { destination: { url }, cancelable: true, preventDefault: vi.fn() };
      listeners.forEach((l) => l(e));
      return e.preventDefault;
    };
    expect(fire("http://x.test/mas/caja/aporte")).not.toHaveBeenCalled();
    expect(fire("http://x.test/mas/caja")).toHaveBeenCalled();
  });

  it("without the Navigation API it still navigates", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "http://x.test/mas/caja", assign },
      addEventListener: vi.fn(),
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    });
    const { offlineDocumentNavigate } = await import("./offline-nav");
    offlineDocumentNavigate("/mas/gastos/nuevo");
    expect(assign).toHaveBeenCalledWith("/mas/gastos/nuevo");
  });
});
