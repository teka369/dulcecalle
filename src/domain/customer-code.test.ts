import { describe, expect, it } from "vitest";
import {
  formatCustomerCode,
  normalizeCustomerCode,
  normalizePersonName,
  parseCustomerCodeNumber,
  validateCustomerLoginInput,
} from "./customer-code";

describe("customer codes", () => {
  it("formats DC-NNNN", () => {
    expect(formatCustomerCode(1)).toBe("DC-0001");
    expect(parseCustomerCodeNumber("DC-0007")).toBe(7);
    expect(normalizeCustomerCode("dc-1")).toBe("DC-0001");
    expect(normalizeCustomerCode("DC 12")).toBe("DC-0012");
  });

  it("validates login input without inventing a code", () => {
    expect(validateCustomerLoginInput("", "Rosa")).toEqual({
      error: "Escribe el código y el nombre.",
    });
    expect(validateCustomerLoginInput("DC-0001", "   ")).toEqual({
      error: "Escribe el código y el nombre.",
    });
    expect(validateCustomerLoginInput(" dc-1 ", "  María  Pérez ")).toEqual({
      code: "DC-0001",
      name: "María Pérez",
    });
  });

  it("compares names case-insensitively after trim", () => {
    expect(normalizePersonName("  MARÍA  Pérez ")).toBe("maría pérez");
  });
});
