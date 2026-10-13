import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coldLoadParentPath,
  entityParentPath,
  bootEntityPatternSources,
} from "./entity-href";
import { DOCUMENTS_MAX_ENTRIES, swNavigationRoute } from "./sw-routing";
import { requiredStaticDocuments } from "./offline-prep";
import { BOOT_ENTITY_ATTR, bootRestoreTarget, bootScriptSource } from "./boot-restore";
import { gestionarIsOffline, GESTIONAR_OFFLINE_TEXT } from "@/components/cash/gestionar-offline";
import { NetworkError } from "@/data/errors";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP = join(__dirname, "../../app");

/** Documented online-only exceptions (cold offline load -> /offline). */
const ONLINE_ONLY: Record<string, string> = {
  "/clientes/[id]/deuda-inicial": "opening balance: online-only on a cold load (in-shell ficha still works)",
  "/cliente/compras/[id]": "customer portal (separate session, not the business shell)",
  "/cliente/productos/[id]": "customer portal (separate session, not the business shell)",
};

function dynamicRoutes(dir = APP): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...dynamicRoutes(full));
    else if (name === "page.tsx") {
      const route = "/" + relative(APP, dir).split("\\\\").join("/");
      if (route.includes("[")) out.push(route);
    }
  }
  return out.sort();
}

const TABLE: Array<[string, string]> = [
  [`/clientes/${ID}`, "/clientes"],
  [`/clientes/${ID}/abono`, "/clientes"],
  [`/ventas/${ID}`, "/ventas"],
  [`/ventas/${ID}/devolver`, "/ventas"],
  [`/inventario/${ID}`, "/inventario"],
  [`/inventario/${ID}/surtir`, "/inventario"],
  [`/inventario/${ID}/preparar`, "/inventario"],
  [`/inventario/${ID}/me-lo-comi`, "/inventario"],
  [`/inventario/${ID}/regalo`, "/inventario"],
  [`/inventario/${ID}/perdido`, "/inventario"],
  [`/inventario/proveedores/${ID}`, "/inventario"],
];

describe("cold offline load coverage", () => {
  it("every dynamic [id] route is restored from a PREP parent doc or is a documented exception", () => {
    const routes = dynamicRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(15);
    const docs = requiredStaticDocuments();
    for (const route of routes) {
      const url = route.replace("[id]", ID);
      const parent = coldLoadParentPath(url);
      if (ONLINE_ONLY[route]) {
        expect(parent, route).toBeNull();
        continue;
      }
      expect(parent, route).not.toBeNull();
      expect(docs, route).toContain(parent);
    }
  });

  it("/inventario/proveedores is not a page nor a PREP doc", () => {
    expect(requiredStaticDocuments()).not.toContain("/inventario/proveedores");
    expect(swNavigationRoute("/inventario/proveedores")).toEqual({ kind: "document" });
  });
});

describe("SW routing table", () => {
  it.each(TABLE)("%s -> %s", (url, parent) => {
    expect(entityParentPath(url)).toBe(parent);
    expect(swNavigationRoute(url)).toEqual({ kind: "entity", fallback: parent });
  });

  it("has exactly 11 entity patterns", () => {
    expect(TABLE).toHaveLength(11);
    expect(new Set(TABLE.map(([u]) => u.replace(ID, ":id"))).size).toBe(11);
  });

  it("gestionar detail -> gestionar list; deuda-inicial -> /offline", () => {
    expect(swNavigationRoute(`/mas/caja/gestionar/${ID}`)).toEqual({ kind: "entity", fallback: "/mas/caja/gestionar" });
    expect(swNavigationRoute(`/clientes/${ID}/deuda-inicial`)).toEqual({ kind: "entity", fallback: null });
  });

  it("leaves /api, /_next, /offline, /sw.js untouched", () => {
    for (const p of ["/api/v1/x", "/_next/static/a.js", "/offline", "/sw.js"]) {
      expect(swNavigationRoute(p)).toEqual({ kind: "passthrough" });
    }
  });

  it("static screens go to the documents cache", () => {
    for (const p of requiredStaticDocuments()) expect(swNavigationRoute(p), p).toEqual({ kind: "document" });
  });
});

describe("documents cache eviction", () => {
  it("50 entity visits online do not evict PREP's static docs", () => {
    // Model of the SW "documents" cache: LRU bounded by DOCUMENTS_MAX_ENTRIES.
    const lru: string[] = [];
    const visit = (path: string) => {
      const route = swNavigationRoute(path);
      if (route.kind !== "document") return;
      const i = lru.indexOf(path);
      if (i >= 0) lru.splice(i, 1);
      lru.push(path);
      while (lru.length > DOCUMENTS_MAX_ENTRIES) lru.shift();
    };
    for (const doc of requiredStaticDocuments()) visit(doc);
    for (let n = 0; n < 50; n++) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, "0")}`;
      const [tpl] = TABLE[n % TABLE.length];
      visit(tpl.replace(ID, id));
      visit(`/mas/caja/gestionar/${id}`);
    }
    for (const doc of requiredStaticDocuments()) expect(lru, doc).toContain(doc);
  });

  it("the documents bound exceeds every static page in src/app", () => {
    const count = (dir: string): number =>
      readdirSync(dir).reduce((n, name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return name.includes("[") ? n : n + count(full);
        return name === "page.tsx" ? n + 1 : n;
      }, 0);
    expect(DOCUMENTS_MAX_ENTRIES).toBeGreaterThan(count(APP));
  });
});

describe("boot restore", () => {
  it("offline restores entity and gestionar detail; online does nothing", () => {
    expect(bootRestoreTarget(`/clientes/${ID}`, true)).toEqual({ kind: "entity", path: `/clientes/${ID}` });
    expect(bootRestoreTarget(`/mas/caja/gestionar/${ID}`, true)).toEqual({
      kind: "server-only",
      path: `/mas/caja/gestionar/${ID}`,
    });
    expect(bootRestoreTarget(`/clientes/${ID}`, false)).toBeNull();
    expect(bootRestoreTarget("/clientes", true)).toBeNull();
    expect(bootRestoreTarget(`/clientes/${ID}/deuda-inicial`, true)).toBeNull();
    expect(bootRestoreTarget(undefined, true)).toBeNull();
  });

  function runScript(pathname: string, onLine: boolean) {
    const attrs: Record<string, string> = {};
    const win: { __DC_BOOT_PATH?: string } = {};
    const fn = new Function("window", "location", "navigator", "document", bootScriptSource(bootEntityPatternSources()));
    fn(win, { pathname }, { onLine }, { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } });
    return { win, attrs };
  }

  it("inline script stores the boot path and marks offline ficha loads only", () => {
    const off = runScript(`/ventas/${ID}/devolver`, false);
    expect(off.win.__DC_BOOT_PATH).toBe(`/ventas/${ID}/devolver`);
    expect(BOOT_ENTITY_ATTR in off.attrs).toBe(true);
    expect(BOOT_ENTITY_ATTR in runScript(`/ventas/${ID}`, true).attrs).toBe(false);
    expect(BOOT_ENTITY_ATTR in runScript("/ventas", false).attrs).toBe(false);
    expect(BOOT_ENTITY_ATTR in runScript(`/mas/caja/gestionar/${ID}`, false).attrs).toBe(false);
  });
});

describe("gestionar cajas offline", () => {
  it("offline or a transport error shows the offline state; server errors do not", () => {
    expect(gestionarIsOffline(true, null)).toBe(true);
    expect(gestionarIsOffline(false, new NetworkError())).toBe(true);
    expect(gestionarIsOffline(false, new Error("500"))).toBe(false);
    expect(GESTIONAR_OFFLINE_TEXT).toBe("Necesitas internet para gestionar cajas");
    expect(requiredStaticDocuments()).toContain("/mas/caja/gestionar");
  });
});
