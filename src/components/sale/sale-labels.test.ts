import { describe, expect, it } from "vitest";
import { saleCustomerLabel, saleDateLabel, saleMethodLabel } from "./sales-list";

describe("sale labels", () => {
  it("customer", () => {
    expect(saleCustomerLabel(null, null)).toBe("Sin cliente");
    expect(saleCustomerLabel("c1", undefined)).toBe("Cliente");
    expect(saleCustomerLabel("c1", "Marta")).toBe("Marta");
  });
  it("method", () => {
    expect(saleMethodLabel("paid", "Nequi")).toBe("Nequi");
    expect(saleMethodLabel("credit", null)).toBe("Fiado");
    expect(saleMethodLabel("partial", "Efectivo")).toBe("Efectivo + Fiado");
  });
  it("date", () => {
    expect(saleDateLabel({ occurredOn: "2026-10-13", createdAt: null })).toBe("13 oct");
    expect(saleDateLabel({ occurredOn: null, createdAt: null })).toBe("Sin fecha");
  });
});
