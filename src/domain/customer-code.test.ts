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

  it("validates a code and a 6-digit PIN", () => {
    expect(validateCustomerLoginInput("", "135790")).toEqual({
      error: "Escribe el código y el PIN de 6 dígitos.",
    });
    expect(validateCustomerLoginInput("DC-0001", "12345")).toEqual({
      error: "Escribe el código y el PIN de 6 dígitos.",
    });
    expect(validateCustomerLoginInput(" dc-1 ", "135790")).toEqual({
      code: "DC-0001",
      pin: "135790",
    });
  });

  it("compares names case-insensitively after trim", () => {
    expect(normalizePersonName("  MARÍA  Pérez ")).toBe("maría pérez");
  });
});
