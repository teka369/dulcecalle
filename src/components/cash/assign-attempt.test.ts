import { describe, expect, it } from "vitest";
import { ASSIGN_ERROR_FALLBACK, assignAttemptFor, assignErrorMessage } from "./assign-attempt";

describe("assignAttemptFor (A3)", () => {
  let n = 0;
  const mint = () => `rid-${++n}`;
  it("reuses the requestId when retrying the same move into the same caja", () => {
    const a = assignAttemptFor(null, "m1", "s1", mint);
    expect(assignAttemptFor(a, "m1", "s1", mint).requestId).toBe(a.requestId);
  });
  it("mints a new requestId for a different caja or move", () => {
    const a = assignAttemptFor(null, "m1", "s1", mint);
    expect(assignAttemptFor(a, "m1", "s2", mint).requestId).not.toBe(a.requestId);
    expect(assignAttemptFor(a, "m2", "s1", mint).requestId).not.toBe(a.requestId);
  });
  it("error copy is Spanish and never empty", () => {
    expect(assignErrorMessage(new Error("La caja destino no está abierta."))).toBe("No se pudo asignar: La caja destino no está abierta.");
    expect(assignErrorMessage(new Error("Algo salió mal."))).toBe(ASSIGN_ERROR_FALLBACK);
    expect(assignErrorMessage("x")).toBe(ASSIGN_ERROR_FALLBACK);
  });
});
