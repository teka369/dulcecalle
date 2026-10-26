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
    ]) expect(userFacingMessage(raw, "FALLBACK"), raw).toMatch(/^(FALLBACK|No encontramos|Revisa los datos|Escribe el monto)/);
  });
  it("keeps plain Spanish messages", () => {
    for (const raw of ["No encontramos eso.", "La caja de ese día ya está cerrada.", "Identificador inválido."]) {
      expect(userFacingMessage(raw, "FALLBACK")).toBe(raw);
    }
    expect(userFacingMessage("", "FALLBACK")).toBe("FALLBACK");
    expect(userFacingMessage(null, "FALLBACK")).toBe("FALLBACK");
  });
});

import { errorText } from "./user-message";

describe("errorText (inline form errors)", () => {
  it("maps known English messages to clear Spanish", () => {
    const cases: Array<[string, string]> = [
      ["product not found", "No encontramos ese producto."],
      ["customer not found", "No encontramos ese cliente."],
      ["supplier not found", "No encontramos ese proveedor."],
      ["sale not found", "No encontramos esa venta."],
      ["Failed to fetch", "Sin conexión. Revisa tu internet e inténtalo de nuevo."],
      ["TypeError: NetworkError when attempting to fetch resource.", "Sin conexión. Revisa tu internet e inténtalo de nuevo."],
      ["The operation was aborted due to timeout", "El servidor tardó demasiado. Inténtalo de nuevo."],
      ["qty must be a positive integer", "Escribe una cantidad entera válida."],
      ["delta must be a non-zero integer", "Escribe una cantidad entera válida."],
      ["COP must be an integer, got 1.5", "Escribe el monto en pesos, sin centavos."],
      ["Unauthorized", "Tu sesión expiró. Vuelve a entrar."],
      ["Forbidden resource", "No tienes permiso para hacer esto."],
      ["ThrottlerException: Too Many Requests", "Demasiados intentos. Espera un momento e inténtalo de nuevo."],
      ["Insufficient stock", "No hay suficiente stock."],
      ["name should not be empty", "Revisa los datos e inténtalo de nuevo."],
    ];
    for (const [raw, want] of cases) expect(errorText(new Error(raw), "FALLBACK"), raw).toBe(want);
  });
  it("keeps useful Spanish; generic fallbacks become clear Spanish", () => {
    expect(errorText(new Error("No hay suficiente stock."), "x")).toBe("No hay suficiente stock.");
    expect(errorText(new Error("Escribe una cantidad."), "x")).toBe("Escribe una cantidad.");
    expect(errorText("not an error", "Error al surtir")).toBe("Error al surtir");
    expect(errorText(new Error("TypeError: x is undefined"), "Error")).toBe("No se pudo completar. Inténtalo de nuevo.");
    expect(errorText(new Error(""), "")).toBe("");
  });
});

import { toUserErrorMessage } from "./user-message";
import { KIND_LOCKED_MESSAGE } from "@/data/pwa/offline-catalog";
import { ONLY_COMBO_SOURCE } from "@/data/pwa/offline-production";

describe("TICKET-A combo domain errors pass through userFacingMessage / errorText / toUserErrorMessage in Spanish", () => {
  it("preserves KIND_LOCKED and combo preparation/sale errors without replacing with generic fallback", () => {
    const messages = [
      KIND_LOCKED_MESSAGE,
      "No se puede cambiar el tipo de un producto con unidades en inventario.",
      "Un combo no se puede vender.",
      ONLY_COMBO_SOURCE,
      "El combo no tiene material disponible. Súrtelo primero.",
      "Este costo supera el valor restante del lote ($ 10.000).",
    ];
    for (const msg of messages) {
      expect(userFacingMessage(msg, "FALLBACK")).toBe(msg);
      expect(errorText(new Error(msg), "FALLBACK")).toBe(msg);
      expect(toUserErrorMessage(new Error(msg), "FALLBACK")).toBe(msg);
    }
  });
});
