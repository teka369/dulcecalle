import { describe, expect, it, vi } from "vitest";
import { previewLines } from "@/domain/reversal";

/** C07.1 (C07-QA-01) — «Corregir pago» previews the correct dry-run, replacement included. */
describe("C07.1 Corregir pago preview", () => {
  const replacement = { customerId: "beto", amount: 2000, method: "Efectivo" as const, requestId: "r-1" };

  it("calls the correct dry-run with the replacement, never the reverse dry-run", async () => {
    const reversals = {
      reversePayment: vi.fn(async () => ({}) as never),
      correctPayment: vi.fn(async () => ({ dryRun: true }) as never),
    };
    const { correctPaymentPreview } = await import("./correct-preview");
    await correctPaymentPreview(reversals, "ana", "pay-1", { reasonCode: "error_digitacion" }, replacement);
    expect(reversals.reversePayment).not.toHaveBeenCalled();
    expect(reversals.correctPayment).toHaveBeenCalledWith(
      "ana",
      "pay-1",
      { reasonCode: "error_digitacion", replacement },
      { dryRun: true },
    );
  });

  it("repro: abono de Ana $ 2.000 → Corregir → Beto shows the replacement and caja $ 13.500", () => {
    const lines = previewLines(
      {
        effects: {
          stockMoves: [],
          cashMoves: [{ method: "Efectivo", amount: 2000 }],
          debtBefore: 2000,
          debtAfter: 4000,
          creditBefore: 0,
          creditAfter: 0,
        },
        warnings: [],
        blockers: [],
        after: { cash: { expectedEfectivo: 11500 } },
        replacementPreview: {
          customerId: "beto",
          amount: 2000,
          method: "Efectivo",
          debtBefore: 4000,
          debtAfter: 2000,
          creditBefore: 0,
          creditAfter: 0,
          expectedEfectivoAfter: 13500,
          expectedNequiAfter: 0,
        },
      },
      "Ana",
      "Beto",
    );
    const t = lines.join("\n").replace(/\u00a0/g, " ");
    expect(t).toMatch(/Sale de la caja: \$ ?2\.000 Efectivo/);
    expect(t).toMatch(/Entra a la caja: \$ ?2\.000 Efectivo/);
    expect(t).toMatch(/Deuda de Ana: \$ ?2\.000 → \$ ?4\.000/);
    expect(t).toMatch(/Deuda de Beto: \$ ?4\.000 → \$ ?2\.000/);
    expect(lines.at(-1)!.replace(/\u00a0/g, " ")).toMatch(/^La caja esperada queda en \$ ?13\.500$/);
    expect(t).not.toMatch(/11\.500/);
  });

  it("Nequi replacement does not change efectivo; caja line uses the netted value", () => {
    const lines = previewLines(
      {
        effects: { cashMoves: [{ method: "Efectivo", amount: 2000 }], debtBefore: 0, debtAfter: 2000 },
        warnings: [],
        after: { cash: { expectedEfectivo: 3000 } },
        replacementPreview: { customerId: "ana", amount: 2000, method: "Nequi", expectedEfectivoAfter: 3000, expectedNequiAfter: 2000 },
      },
      "Ana",
      "Ana",
    ).map((l) => l.replace(/\u00a0/g, " "));
    expect(lines).toContainEqual(expect.stringMatching(/^Entra a Nequi: \$ ?2\.000 \(no cambia el efectivo\)$/));
    expect(lines.at(-1)).toMatch(/^La caja esperada queda en \$ ?3\.000$/);
  });
});
