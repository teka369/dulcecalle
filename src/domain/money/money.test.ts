import { describe, expect, it } from "vitest";
import { addCop, asCop, formatCop, mulCop, subCop } from "./money";

describe("money COP", () => {
  it("formatCop uses es-CO currency with 0 fraction digits", () => {
    expect(formatCop(1500)).toBe(
      new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(1500),
    );
    expect(formatCop(1500)).toMatch(/1\.500/);
    expect(formatCop(1500)).toMatch(/\$/);
  });

  it("rejects non-integers", () => {
    expect(() => asCop(1.5)).toThrow();
  });

  it("add/sub/mul stay integer", () => {
    expect(addCop(1000, 500)).toBe(1500);
    expect(subCop(1000, 400)).toBe(600);
    expect(mulCop(1000, 3)).toBe(3000);
  });
});
