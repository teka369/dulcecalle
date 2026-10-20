import { describe, expect, it } from "vitest";
import { userFacingMessage } from "./user-message";

describe("userFacingMessage", () => {
  it("hides technical / validator / runtime text", () => {
    for (const raw of [
      "product.id must be a UUID string",
      "id must be a UUID",
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "Unexpected token < in JSON at position 0",
      "price must be a JSON integer COP, got 1.5",
      "invalid occurredOn/localDate: undefined",
      "product not found",
      "Internal server error",
    ]) expect(userFacingMessage(raw, "FALLBACK"), raw).toBe("FALLBACK");
  });
  it("keeps plain Spanish messages", () => {
    for (const raw of ["No encontramos eso.", "La caja de ese día ya está cerrada.", "Identificador inválido."]) {
      expect(userFacingMessage(raw, "FALLBACK")).toBe(raw);
    }
    expect(userFacingMessage("", "FALLBACK")).toBe("FALLBACK");
    expect(userFacingMessage(null, "FALLBACK")).toBe("FALLBACK");
  });
});
