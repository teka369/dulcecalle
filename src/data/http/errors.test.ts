import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromBody } from "../errors";

describe("HTTP error mapping", () => {
  it("preserves contractual codes and Spanish messages", () => {
    const cases = [
      [409, "ABONO_EXCEEDS_DEBT", "El abono no puede ser mayor al saldo."],
      [409, "CLOSED_DAY", "No se puede editar el día."],
      [409, "SESSION_ALREADY_CLOSED", "El día está cerrado."],
      [409, "NEED_COST", "Si hay stock, ponle lo que te costó."],
      [409, "STOCK_VIA_MOVES", "El stock solo cambia con surtir, ventas, mermas, devoluciones o el alta inicial."],
      [409, "INSUFFICIENT_STOCK", "No hay suficiente stock."],
      [403, "FORBIDDEN", "No tienes permiso."],
      [401, "UNAUTHORIZED", "Inicia sesión."],
      [404, "NOT_FOUND", "No encontramos eso."],
      [400, "VALIDATION", "Idempotency-Key is required (UUID)."],
    ] as const;
    for (const [status, code, message] of cases) {
      const err = apiErrorFromBody(status, { error: { code, message } });
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe(code);
      expect(err.message).toBe(message);
      expect(err.status).toBe(status);
    }
  });
});
