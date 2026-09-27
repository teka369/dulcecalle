import { beforeEach, describe, expect, it, vi } from "vitest";
import { onOfflineLinkClick } from "./OfflineLink";

function click(button = 0, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) {
  const prevented: boolean[] = [];
  return {
    event: {
      metaKey: extra.metaKey ?? false,
      ctrlKey: extra.ctrlKey ?? false,
      shiftKey: extra.shiftKey ?? false,
      altKey: extra.altKey ?? false,
      button,
      preventDefault: () => {
        prevented.push(true);
      },
    },
    prevented,
  };
}

describe("OfflineLink", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("assigns the document on a normal offline click", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", {
      location: { assign: (href: string) => void assigned.push(href) },
    });
    const { event, prevented } = click();
    onOfflineLinkClick(event, "/ventas/nueva");
    expect(prevented).toEqual([true]);
    expect(assigned).toEqual(["/ventas/nueva"]);
  });

  it("leaves an online click to the normal Link", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("window", {
      location: { assign: (href: string) => void assigned.push(href) },
    });
    const { event, prevented } = click();
    onOfflineLinkClick(event, "/mas/caja");
    expect(prevented).toEqual([]);
    expect(assigned).toEqual([]);
  });

  it("does not hijack modified clicks while offline", () => {
    const assigned: string[] = [];
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", {
      location: { assign: (href: string) => void assigned.push(href) },
    });
    const { event, prevented } = click(0, { metaKey: true });
    onOfflineLinkClick(event, "/inventario/nuevo");
    expect(prevented).toEqual([]);
    expect(assigned).toEqual([]);
  });
});
