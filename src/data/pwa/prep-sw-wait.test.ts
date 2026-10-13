import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForServiceWorkerControl } from "./offline-prep";

function stubSw(sw: Record<string, unknown>) {
  vi.stubGlobal("window", { navigator: { serviceWorker: sw } });
}

describe("B6: prep waits for the service worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns immediately when the page is already controlled", async () => {
    stubSw({ controller: {} });
    await expect(waitForServiceWorkerControl(10)).resolves.toBe(true);
  });

  it("first install: waits for ready + controllerchange before resolving", async () => {
    let fire: () => void = () => undefined;
    let readyResolve: () => void = () => undefined;
    const sw: Record<string, unknown> = {
      controller: null,
      ready: new Promise<void>((r) => (readyResolve = r)),
      addEventListener: (_: string, cb: () => void) => (fire = cb),
    };
    stubSw(sw);
    let done = false;
    const p = waitForServiceWorkerControl(5_000).then((v) => {
      done = true;
      return v;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    readyResolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    sw.controller = {};
    fire();
    await expect(p).resolves.toBe(true);
  });

  it("gives up after the timeout (no SW support / never controls)", async () => {
    vi.useFakeTimers();
    stubSw({ controller: null, ready: new Promise(() => undefined), addEventListener: () => undefined });
    const p = waitForServiceWorkerControl(1000);
    await vi.advanceTimersByTimeAsync(1001);
    await expect(p).resolves.toBe(false);
  });
});
