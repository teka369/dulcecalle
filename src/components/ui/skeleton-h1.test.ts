import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SkeletonHero } from "./Skeleton";

const SRC = join(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(n)) out.push(p);
  }
  return out;
}

describe("loading skeletons carry the page h1", () => {
  it("SkeletonHero renders exactly one (sr-only) h1 with the title", () => {
    const out = renderToStaticMarkup(h(SkeletonHero, { title: "Caja" }));
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('class="sr-only">Caja</h1>');
  });
  it("defaults to «Cargando…»", () => {
    expect(renderToStaticMarkup(h(SkeletonHero))).toContain(">Cargando…</h1>");
  });
  it("every usage passes a page title (Caja/Gastos included)", () => {
    const users = [...walk(join(SRC, "app")), ...walk(join(SRC, "components"))].filter((f) =>
      readFileSync(f, "utf8").includes("<SkeletonHero"),
    );
    expect(users.length).toBeGreaterThanOrEqual(12);
    for (const f of users) expect(readFileSync(f, "utf8"), f).not.toContain("<SkeletonHero />");
    expect(readFileSync(join(SRC, "app/mas/caja/page.tsx"), "utf8")).toContain("<SkeletonHero title={CASH_COPY.titleCaja} />");
    expect(readFileSync(join(SRC, "app/mas/gastos/page.tsx"), "utf8")).toContain("<SkeletonHero title={CASH_COPY.masGastos} />");
  });
});
