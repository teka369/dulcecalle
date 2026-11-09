import { describe, expect, it } from "vitest";
import {
  OFFLINE_REVERSAL_TEXT,
  REVERSAL_REASONS,
  UNDO_WINDOW_MS,
  blockerText,
  canUndoSale,
  daysOld,
  previewLines,
  reasonBody,
  reasonError,
  reasonLabel,
  reversalActionState,
  reversalBadge,
  reversalErrorText,
  warningText,
} from "./index";
import { mapPayment, mapSale } from "@/data/http/mappers";
import { portalPaymentReversal, purchaseLabel, purchaseTone } from "@/components/customer/portal";
import { kindLabel } from "@/components/cash/cash";

describe("C07 reversal domain", () => {
  it("lists the six reasons of decision 10 in order with Colombian labels", () => {
    expect(REVERSAL_REASONS.map((r) => r.code)).toEqual([
      "error_digitacion",
      "cliente_equivocado",
      "monto_equivocado",
      "duplicado",
      "devolucion",
      "otro",
    ]);
    expect(reasonLabel("monto_equivocado")).toBe("Monto equivocado");
    expect(reasonLabel("desconocido")).toBe("Otro");
  });

  it("requires a reason; free text only with «Otro» (5–280, trimmed) — T14", () => {
    expect(reasonError(null, "")).toBe("Elige un motivo.");
    expect(reasonError("otro", "   ")).toMatch(/Cuéntanos/);
    expect(reasonError("otro", " ab ")).toMatch(/Cuéntanos/);
    expect(reasonError("otro", "Se cayó el sistema")).toBeNull();
    expect(reasonError("cliente_equivocado", "")).toBeNull();
    expect(reasonError("duplicado", "x".repeat(281))).toMatch(/Cuéntanos/);
    expect(reasonBody("otro", "  Se cayó  ")).toEqual({ reasonCode: "otro", reasonText: "Se cayó" });
    expect(reasonBody("duplicado", "ignored")).toEqual({ reasonCode: "duplicado" });
  });

  it("staff never sees the action; offline it is disabled; voided → hidden (W1/W6, T13/T18)", () => {
    expect(reversalActionState({ isOwner: false, online: true, reversed: false })).toBe("hidden");
    expect(reversalActionState({ isOwner: null, online: true, reversed: false })).toBe("hidden");
    expect(reversalActionState({ isOwner: true, online: false, reversed: false })).toBe("disabled");
    expect(reversalActionState({ isOwner: true, online: true, reversed: true })).toBe("hidden");
    expect(reversalActionState({ isOwner: true, online: true, reversed: false })).toBe("enabled");
    expect(OFFLINE_REVERSAL_TEXT).toBe("Necesita conexión para anular");
  });

  it("«Deshacer» only owner, online, within 2 minutes (T26)", () => {
    const createdAt = 1_000_000;
    const base = { createdAt, isOwner: true, online: true, reversed: false };
    expect(canUndoSale({ ...base, now: createdAt + 60_000 })).toBe(true);
    expect(canUndoSale({ ...base, now: createdAt + UNDO_WINDOW_MS + 1 })).toBe(false);
    expect(canUndoSale({ ...base, now: createdAt + 60_000, isOwner: false })).toBe(false);
    expect(canUndoSale({ ...base, now: createdAt + 60_000, online: false })).toBe(false);
    expect(canUndoSale({ ...base, now: createdAt + 60_000, pending: true })).toBe(false);
  });

  it("builds the W2 preview from the dry-run effects (Nequi never touches efectivo)", () => {
    const lines = previewLines(
      {
        effects: {
          stockMoves: [{ productId: "p", delta: 2 }],
          cashMoves: [{ method: "Efectivo", amount: 12000 }],
          debtBefore: 30000,
          debtAfter: 30000,
          creditBefore: 0,
          creditAfter: 0,
        },
        warnings: [],
        blockers: [],
        after: { cash: { expectedEfectivo: 8000 } },
      },
      "Ana",
    );
    expect(lines[0]).toBe("Vuelven al inventario: 2 productos");
    expect(lines[1]).toMatch(/^Sale de la caja: .*12\.000 Efectivo$/);
    expect(lines[2]).toMatch(/^Deuda de Ana: .*30\.000 → .*30\.000$/);
    expect(lines[3]).toMatch(/^La caja esperada queda en .*8\.000$/);
    const nequi = previewLines({ effects: { cashMoves: [{ method: "Nequi", amount: 5000 }] }, warnings: [], after: { cash: { expectedEfectivo: 1 } } }, null);
    expect(nequi).toEqual([expect.stringMatching(/^Sale de Nequi: .*5\.000 \(no cambia el efectivo\)$/)]);
    expect(previewLines({ effects: { cashMoves: [] } , warnings: [] }, null)).toEqual(["No mueve la caja"]);
  });

  it("maps blockers, warnings and errors to copy (W2 variants)", () => {
    expect(blockerText("CASH_SESSION_REQUIRED")).toBe("Abre la caja de hoy para anular.");
    expect(blockerText("CLOSED_DAY")).toBe("Ese día ya se cerró. Abre la caja de hoy.");
    expect(warningText("EXPECTED_CASH_NEGATIVE", { effects: {}, warnings: [], after: { cash: { expectedEfectivo: -4000 } } })).toMatch(/^La caja esperada quedará en −.*4\.000\. Revisa el efectivo\.$/);
    expect(reversalErrorText("ALREADY_REVERSED", "sale")).toBe("Esta venta ya estaba anulada.");
    expect(reversalErrorText("ALREADY_REVERSED", "payment")).toBe("Este pago ya estaba anulado.");
    expect(reversalErrorText("CREDIT_ALREADY_REFUNDED", "payment")).toMatch(/ya se devolvió/);
    expect(reversalErrorText(undefined, "sale")).toBe("No se pudo anular. Intenta otra vez.");
  });

  it("counts days for the > 30 days confirmation (G4b, T21)", () => {
    expect(daysOld("2026-10-09", "2026-11-09")).toBe(31);
    expect(daysOld("2026-11-09", "2026-11-09")).toBe(0);
  });

  it("badges never carry the free text (J5)", () => {
    expect(reversalBadge("sale", { number: "DC-R-000001", reasonCode: "monto_equivocado" })).toBe("Anulada · Monto equivocado");
    expect(reversalBadge("payment", { number: "DC-R-000002", reasonCode: "otro" })).toBe("Anulado · Otro");
  });
});

describe("C07 mappers, portal and caja", () => {
  const sale = {
    id: "22222222-2222-4222-8222-222222222222",
    customerId: null,
    paymentKind: "paid",
    method: "Efectivo",
    saleTotal: 2000,
    amountReceived: 2000,
    credit: 0,
    note: null,
    occurredOn: "2026-11-09",
    createdAt: "2026-11-09T15:00:00.000Z",
    lines: [],
  };
  it("maps the sale/payment reversal ref only when the server sends it", () => {
    expect(mapSale(sale)).not.toHaveProperty("reversal");
    expect(mapSale({ ...sale, reversal: null }).reversal).toBeNull();
    expect(
      mapSale({ ...sale, reversal: { id: "r1", number: "DC-R-000001", reasonCode: "duplicado", reasonText: null, createdAt: "2026-11-09T15:01:00.000Z" } }).reversal,
    ).toEqual({ id: "r1", number: "DC-R-000001", reasonCode: "duplicado", reasonText: null, createdAt: Date.parse("2026-11-09T15:01:00.000Z") });
    const p = mapPayment({
      id: "33333333-3333-4333-8333-333333333333",
      customerId: "44444444-4444-4444-8444-444444444444",
      amount: 500,
      method: "Nequi",
      occurredOn: "2026-11-09",
      createdAt: "2026-11-09T15:00:00.000Z",
      reversal: null,
      replacesPaymentId: "55555555-5555-4555-8555-555555555555",
      replacedByPaymentId: null,
    });
    expect([p.reversal, p.replacesPaymentId, p.replacedByPaymentId]).toEqual([null, "55555555-5555-4555-8555-555555555555", undefined]);
  });

  it("portal: voided purchase «Anulada · motivo», voided abono «Anulado · motivo» (T16, W7)", () => {
    const rev = { number: "DC-R-000001", reasonCode: "cliente_equivocado" };
    expect(purchaseLabel(3000, "credit", 0, rev)).toBe("Anulada · Cliente equivocado");
    expect(purchaseTone(3000, "credit", 0, rev)).toBe("info");
    expect(purchaseLabel(3000, "credit", 0, null)).toBe("Saldada");
    expect(portalPaymentReversal({ reversal: rev })).toBe("Anulado · Cliente equivocado");
    expect(portalPaymentReversal({})).toBeNull();
  });

  it("caja shows the reverso move as «Reverso»", () => {
    expect(kindLabel("reverso")).toBe("Reverso");
  });
});
