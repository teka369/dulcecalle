import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
const read = (p: string) => readFileSync(p, "utf8");

describe("P6 hardening", () => {
  it("no ⏳ status emoji in UI code", () => {
    expect(files.filter((f) => read(f).includes("⏳") && !f.endsWith("StatusBadge.tsx"))).toEqual([]);
  });
  it("no hex colors in components/pages (layout metadata excepted)", () => {
    const bad = files.filter((f) => !f.endsWith("layout.tsx") && /#[0-9a-fA-F]{6}\b/.test(read(f)));
    expect(bad).toEqual([]);
  });
  it("PageHeader stays exported but unused", () => {
    expect(files.filter((f) => !/ui\/(PageHeader|index)\.tsx?$/.test(f) && read(f).includes("PageHeader"))).toEqual([]);
  });
  it("P6 screens use HeroBlock with exactly one h1 source", () => {
    for (const r of ["login", "acceso-tienda", "offline", "sincronizacion", "cliente/login"]) {
      const s = read(join(ROOT, "app", r, "page.tsx"));
      expect(s, r).toContain("<HeroBlock");
      expect(s, r).not.toContain("<h1");
    }
    expect(read(join(ROOT, "components/customer/CustomerLoginForm.tsx"))).not.toContain("<h1");
  });
  it("offline page CTA uses on-hero colors; sync empty copy", () => {
    expect(read(join(ROOT, "app/offline/page.tsx"))).toContain("bg-on-hero");
    expect(read(join(ROOT, "app/sincronizacion/page.tsx"))).toContain("No hay operaciones por enviar desde este teléfono.");
  });
  it("globals: focus-visible and reduced-motion", () => {
    const css = read(join(ROOT, "app/globals.css"));
    expect(css).toContain(".hero-block :focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});

describe("P6 tester fixes", () => {
  it("viewport allows zoom", () => {
    const s = read(join(ROOT, "app/layout.tsx"));
    expect(s).not.toMatch(/maximumScale|userScalable/);
  });
  it("nav labels are not truncated and Inventario gets extra room", () => {
    const s = read(join(ROOT, "components/shell/BottomNav.tsx"));
    expect(s).toContain("whitespace-nowrap");
    expect(s).toContain("item.label.length > 8");
    expect(s).not.toMatch(/max-w-full truncate/);
  });
  it("PrepModal task names ellipsize", () => {
    expect(read(join(ROOT, "components/shell/PrepModal.tsx"))).toContain('<span className="min-w-0 truncate">{task.label}</span>');
  });
});
