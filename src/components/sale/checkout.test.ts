import { beforeEach, describe, expect, it, vi } from "vitest";
import { __detachCartMemoryForTests, cartStore } from "@/store/cartStore";
import {
  CHECKOUT_DEFAULTS,
  buildSaleRequest,
  canRegister,
  checkoutReducer,
  fiadoFor,
  linesTotal,
  receivedFor,
  showsMethod,
  summarizeSales,
  tapsFromCart,
  type CheckoutAction,
  type CheckoutState,
} from "./checkout";

const LINES = [
  { productId: "p1", qty: 2, unitPrice: 1500 },
  { productId: "p2", qty: 1, unitPrice: 2000 },
];
const TOTAL = 5000;

function fromCart(): CheckoutState {
  const s = cartStore.getSnapshot();
  return { paymentKind: s.paymentKind, method: s.method, customerId: s.customerId, abonoInput: "" };
}

/** Simulates the Cobrar screen: each action is one tap/choice. */
function run(actions: CheckoutAction[]): { state: CheckoutState; taps: number } {
  let state = fromCart();
  for (const a of actions) state = checkoutReducer(state, a);
  return { state, taps: 1 /* Cobrar */ + actions.length + 1 /* Registrar */ };
}

describe("Cobrar: cash-paid sale in 2 taps", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", undefined);
    __detachCartMemoryForTests();
  });

  it("a fresh cart opens Cobrar as Pagada + Efectivo (cartStore defaults)", () => {
    expect(fromCart()).toEqual(CHECKOUT_DEFAULTS);
    expect(CHECKOUT_DEFAULTS).toMatchObject({ paymentKind: "paid", method: "Efectivo", customerId: null });
  });

  it("Cobrar → Registrar is enough: Registrar is enabled with no extra choice", () => {
    const { state, taps } = run([]);
    expect(canRegister(state, TOTAL, LINES.length)).toBe(true);
    expect(taps).toBe(2);
    expect(tapsFromCart({ paymentKind: "paid", method: "Efectivo" })).toBe(2);
    expect(buildSaleRequest(state, LINES, "")).toEqual({
      lines: LINES,
      paymentKind: "paid",
      customerId: undefined,
      amountReceived: 5000,
      method: "Efectivo",
    });
  });

  it("after a sale the cart resets, so the next cash sale is 2 taps again", () => {
    cartStore.setPaymentKind("credit");
    cartStore.setMethod("Nequi");
    cartStore.clear();
    const { state, taps } = run([]);
    expect(state).toEqual(CHECKOUT_DEFAULTS);
    expect(taps).toBe(2);
  });

  it("Nequi costs one more tap (3)", () => {
    const { state, taps } = run([{ type: "method", method: "Nequi" }]);
    expect(taps).toBe(3);
    expect(tapsFromCart({ paymentKind: "paid", method: "Nequi" })).toBe(3);
    expect(canRegister(state, TOTAL, 2)).toBe(true);
    expect(buildSaleRequest(state, LINES, "").method).toBe("Nequi");
  });

  it("Fiada needs a customer and hides the method", () => {
    let s = checkoutReducer(CHECKOUT_DEFAULTS, { type: "kind", kind: "credit" });
    expect(showsMethod(s)).toBe(false);
    expect(canRegister(s, TOTAL, 2)).toBe(false);
    s = checkoutReducer(s, { type: "customer", customerId: "c1" });
    expect(canRegister(s, TOTAL, 2)).toBe(true);
    const req = buildSaleRequest(s, LINES, "  ");
    expect(req).toMatchObject({ paymentKind: "credit", customerId: "c1", amountReceived: 0, method: undefined });
    expect(req).not.toHaveProperty("note");
  });

  it("Parcial needs customer and 0 < abono < total", () => {
    let s = checkoutReducer(CHECKOUT_DEFAULTS, { type: "kind", kind: "partial" });
    s = checkoutReducer(s, { type: "abono", digits: "$ 2.000" });
    expect(s.abonoInput).toBe("2000");
    expect(canRegister(s, TOTAL, 2)).toBe(false);
    s = checkoutReducer(s, { type: "customer", customerId: "c1" });
    expect(canRegister(s, TOTAL, 2)).toBe(true);
    expect(canRegister({ ...s, abonoInput: "5000" }, TOTAL, 2)).toBe(false);
    expect(canRegister({ ...s, abonoInput: "0" }, TOTAL, 2)).toBe(false);
  });

  it("back to Pagada drops customer and abono", () => {
    let s = checkoutReducer(CHECKOUT_DEFAULTS, { type: "kind", kind: "partial" });
    s = checkoutReducer(s, { type: "customer", customerId: "c1" });
    s = checkoutReducer(s, { type: "abono", digits: "100" });
    s = checkoutReducer(s, { type: "kind", kind: "paid" });
    expect(s).toEqual(CHECKOUT_DEFAULTS);
  });

  it("empty cart can never register", () => {
    expect(canRegister(CHECKOUT_DEFAULTS, 0, 0)).toBe(false);
  });
});

describe("metrics stay separate (ventas ≠ recibido ≠ fiado ≠ caja)", () => {
  it("a partial sale splits ventas into recibido and fiado without merging", () => {
    const s: CheckoutState = { paymentKind: "partial", method: "Efectivo", customerId: "c1", abonoInput: "2000" };
    expect(linesTotal(LINES)).toBe(5000);
    expect(receivedFor(s, TOTAL)).toBe(2000);
    expect(fiadoFor(s, TOTAL)).toBe(3000);
    expect(buildSaleRequest(s, LINES, "").amountReceived).toBe(2000);
  });

  it("summarizeSales keeps each total on its own field and has no caja", () => {
    const sum = summarizeSales([
      { saleTotal: 5000, amountReceived: 5000, credit: 0 },
      { saleTotal: 6000, amountReceived: 2000, credit: 4000 },
      { saleTotal: 3000, amountReceived: 0, credit: 3000 },
    ]);
    expect(sum).toEqual({ ventas: 14000, recibido: 7000, fiado: 7000, count: 3 });
    expect(Object.keys(sum).sort()).toEqual(["count", "fiado", "recibido", "ventas"]);
    expect(sum).not.toHaveProperty("caja");
  });

  it("recibido in a Nequi sale is not caja efectivo (method is carried, not merged)", () => {
    const s = checkoutReducer(CHECKOUT_DEFAULTS, { type: "method", method: "Nequi" });
    const req = buildSaleRequest(s, LINES, "");
    expect(req.amountReceived).toBe(5000);
    expect(req.method).toBe("Nequi");
  });
});
