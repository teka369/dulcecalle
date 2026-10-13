import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { HeroBlock } from "./HeroBlock";
import { HeroAmount } from "./HeroAmount";
import { HeroPill } from "./HeroPill";
import { HeroSegmented } from "./HeroSegmented";
import { HeroSearch } from "./HeroSearch";
import { Sheet } from "./Sheet";
import { SectionHead } from "./SectionHead";
import { RowGroup, RowGroupNote } from "./RowGroup";
import { Row } from "./Row";
import { SegmentedMetrics } from "./SegmentedMetrics";
import { QuickTiles } from "./QuickTiles";
import { ChoiceSegmented } from "./ChoiceSegmented";
import { AmountField, digitsOnly } from "./AmountField";
import { ActionBar, ACTION_BAR_SPACE, ABOVE_ACTION_BAR } from "./ActionBar";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StateBlock } from "./StateBlock";
import { SkeletonHero, SkeletonRows } from "./Skeleton";
import { PendingBadge } from "./StatusBadge";

const html = (el: ReturnType<typeof h>) => renderToStaticMarkup(el);

describe("V2 primitives", () => {
  it("HeroBlock: single h1, hero tokens, back link with accessible name, offline band", () => {
    const out = html(
      h(HeroBlock, { title: "Cobrar", back: { href: "/ventas/nueva", label: "Volver" }, offline: { capturedAt: 0 } }),
    );
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain("bg-hero");
    expect(out).toContain('aria-label="Volver"');
    expect(out).toContain("Sin conexión · actualizado");
    expect(html(h(HeroBlock, { offline: { text: "Sin conexión · x" } }))).toContain("Sin conexión · x");
    expect(html(h(HeroBlock, { busy: true }))).toContain('aria-busy="true"');
  });

  it("HeroAmount shows tone as a dot, never colours the number", () => {
    const out = html(h(HeroAmount, { label: "Total", value: "$ 5.000", tone: "danger" }));
    expect(out).toContain("bg-danger");
    expect(out).not.toContain("text-danger");
  });

  it("HeroPill renders link or button", () => {
    expect(html(h(HeroPill, { href: "/x", label: "Nueva venta" }))).toMatch(/<a [^>]*href="\/x"/);
    expect(html(h(HeroPill, { label: "Ok", onClick: () => {} }))).toContain('type="button"');
  });

  it("HeroSegmented exposes tablist + aria-selected", () => {
    const out = html(
      h(HeroSegmented<"a" | "b">, {
        label: "Filtro",
        options: [{ id: "a", label: "A" }, { id: "b", label: "B", count: 2 }],
        value: "b",
        onChange: () => {},
      }),
    );
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Filtro"');
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it("HeroSearch has a label and type=search", () => {
    const out = html(h(HeroSearch, { value: "", onChange: () => {}, placeholder: "Buscar dulce..." }));
    expect(out).toContain('type="search"');
    expect(out).toMatch(/<label[^>]*class="sr-only"[^>]*>Buscar dulce\.\.\.<\/label>/);
  });

  it("Sheet / SectionHead / RowGroup / Row", () => {
    expect(html(h(Sheet, null, "x"))).toContain("rounded-t-[28px]");
    expect(html(h(SectionHead, { title: "Hoy", link: { href: "/v", label: "Ver" } }))).toMatch(/<h2[^>]*>Hoy<\/h2>/);
    const row = html(h(RowGroup, null, h(Row, { href: "/ventas/1", title: "Venta", trailing: "$ 1" })));
    expect(row).toContain("<ul");
    expect(row).toContain('href="/ventas/1"');
    expect(row).toContain("min-h-14");
    expect(html(h(RowGroupNote, null, "Nadie debe…"))).toContain("Nadie debe…");
  });

  it("SegmentedMetrics keeps one labelled cell per metric", () => {
    const out = html(
      h(SegmentedMetrics, {
        label: "Señales",
        items: [
          { icon: "alert", label: "Recibido", value: "$ 1" },
          { icon: "users", label: "Fiado", value: "$ 2", detail: "2 fiados" },
        ],
      }),
    );
    expect(out).toContain('aria-label="Señales"');
    expect(out).toContain("Recibido");
    expect(out).toContain("Fiado");
    expect(out).toContain("grid-cols-2");
  });

  it("QuickTiles renders one link per tile", () => {
    const out = html(h(QuickTiles, { tiles: [{ href: "/a", label: "A", icon: "users" }, { href: "/b", label: "B", icon: "bag" }] }));
    expect(out.match(/<a /g)).toHaveLength(2);
  });

  it("ChoiceSegmented is a radiogroup with a check on the selected option", () => {
    const out = html(
      h(ChoiceSegmented<"paid" | "partial" | "credit">, {
        label: "¿Cómo pagan?",
        options: [{ id: "paid", label: "Pagada" }, { id: "partial", label: "Parcial" }, { id: "credit", label: "Fiada" }],
        value: "paid",
        onChange: () => {},
      }),
    );
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/role="radio"/g)).toHaveLength(3);
    expect(out.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-checked="true"[^>]*tabindex="0"[^>]*class="[^"]*bg-cta text-cta-fg/);
    expect(out).toContain("m5 12 5 5 9-10");
  });

  it("AmountField: numeric keyboard, linked hint/error, digits only", () => {
    const out = html(h(AmountField, { label: "Recibido", value: "2000", onChange: () => {}, hint: "Queda debiendo $ 3.000", error: "x" }));
    expect(out).toContain('inputMode="numeric"');
    expect(out).toMatch(/aria-describedby="[^"]+-hint [^"]+-err"/);
    expect(out).toContain('aria-invalid="true"');
    expect(digitsOnly("$ 2.000")).toBe("2000");
  });

  it("ActionBar: safe-area aware, disabled when not allowed", () => {
    const on = html(h(ActionBar, { primary: { label: "Registrar", onClick: () => {} }, summary: "$ 5.000" }));
    expect(on).toContain("safe-area-inset-bottom");
    expect(on).not.toContain('disabled=""');
    const off = html(h(ActionBar, { primary: { label: "Cobrar", onClick: () => {}, disabled: true } }));
    expect(off).toContain('disabled=""');
    expect(html(h(ActionBar, { aboveNav: true, primary: { label: "x", onClick: () => {} } }))).toContain("var(--nav-h)");
  });

  it("SyncPill lifts above the ActionBar and toasts stack above the pill", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/html\[data-actionbar="on"\] \.sync-pill \{\s*bottom: calc\(var\(--actionbar-h\) \+ [\d.]+rem\)/);
    expect(css).toMatch(/html\[data-actionbar="nav"\] \.sync-pill/);
    expect(css).toMatch(/--syncpill-h:/);
    expect(ABOVE_ACTION_BAR).toContain("var(--syncpill-h)");
    const pill = readFileSync(join(process.cwd(), "src/components/shell/SyncPill.tsx"), "utf8");
    expect(pill).toContain("sync-pill ");
  });

  it("ActionBar space comes from the --actionbar-h CSS variable", () => {
    expect(ACTION_BAR_SPACE).toContain("var(--actionbar-h)");
    expect(ABOVE_ACTION_BAR).toContain("var(--actionbar-h)");
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/--actionbar-h:\s*calc\([^;]*safe-area-inset-bottom/);
  });

  it("StateBlock roles, skeletons busy, PendingBadge without emoji", () => {
    expect(html(h(StateBlock, { kind: "error", title: "No se pudo cargar." }))).toContain('role="alert"');
    expect(html(h(StateBlock, { kind: "empty", title: "Vacío" }))).toContain('role="status"');
    expect(html(h(SkeletonHero))).toContain('aria-busy="true"');
    expect(html(h(SkeletonRows, { rows: 2 }))).toContain('aria-hidden="true"');
    const badge = html(h(PendingBadge));
    expect(badge).toContain("Pendiente");
    expect(badge).not.toContain("⏳");
  });
});
