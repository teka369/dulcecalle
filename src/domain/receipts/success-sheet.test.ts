import { describe, expect, it } from "vitest";
import { formatCop } from "@/domain/money";
import {
  LINK_NOTICE,
  OFFLINE_LINK_NOTICE,
  linkShareText,
  mapReceiptRefs,
  shareableReceipt,
  successView,
  whatsappHref,
} from "./success-sheet";

const SALE_R = { id: "r-1", kind: "sale", number: "DC-000125", verifyCode: "ABCD234567" };

/** C09-PR6 — hoja de éxito (WIRES-C09 W2, SPEC-C09 §5.1 / §11.2-3, T21). */
describe("successView", () => {
  it("online sale with customer: «Listo · DC-…», link actions and the 48 h notice", () => {
    const v = successView({ op: "sale", mode: "online", number: "DC-000125", receipt: SALE_R, hasCustomer: true, amount: 3000 });
    expect(v.title).toBe("Listo · DC-000125");
    expect(v.canLink).toBe(true);
    expect(v.linkNotice).toBe(LINK_NOTICE);
    expect(LINK_NOTICE).toBe("El enlace sirve una vez por 48 horas y pide el PIN del cliente.");
    expect(v.offlineNotice).toBeNull();
    expect(v.reference).toBeNull();
  });

  it("online sale without customer: internal receipt, never a link (T5), only plain text", () => {
    const v = successView({ op: "sale", mode: "online", number: "DC-000126", receipt: { ...SALE_R, number: "DC-000126" }, hasCustomer: false, amount: 1500 });
    expect(v.title).toBe("Listo · DC-000126");
    expect(v.canLink).toBe(false);
    expect(v.linkNotice).toBeNull();
    expect(v.plainText).toBe(`Comprobante DC-000126 · ${formatCop(1500)}`);
  });

  it("online without a number from the server: honest generic title, no link", () => {
    const v = successView({ op: "sale", mode: "online", number: null, receipt: null, hasCustomer: true, amount: 1500 });
    expect(v.title).toBe("Venta registrada");
    expect(v.canLink).toBe(false);
    expect(v.plainText).toBe(`Venta · ${formatCop(1500)}`);
  });

  it("offline sale: saved on this phone, L- ref, no DC- and no link until it is sent", () => {
    const v = successView({ op: "sale", mode: "offline", localRef: "L-261115-AB12", hasCustomer: true, amount: 3000 });
    expect(v.title).toBe("Venta guardada en este teléfono");
    expect(v.reference).toBe("Ref. local L-261115-AB12");
    expect(v.canLink).toBe(false);
    expect(v.offlineNotice).toBe(OFFLINE_LINK_NOTICE);
    expect(OFFLINE_LINK_NOTICE).toBe("El enlace estará cuando se envíe.");
    expect(v.plainText).toBe(`Venta · ${formatCop(3000)} · Ref. local L-261115-AB12`);
    expect(v.title + v.plainText).not.toMatch(/DC-/);
  });

  it("abono online and offline", () => {
    const on = successView({ op: "payment", mode: "online", number: "DC-P-000045", receipt: { ...SALE_R, kind: "payment", number: "DC-P-000045" }, hasCustomer: true, amount: 5000 });
    expect(on.title).toBe("Listo · DC-P-000045");
    expect(on.canLink).toBe(true);
    const off = successView({ op: "payment", mode: "offline", localRef: "L-261115-CD34", hasCustomer: true, amount: 5000 });
    expect(off.title).toBe("Abono guardado en este teléfono");
    expect(off.plainText).toBe(`Abono · ${formatCop(5000)} · Ref. local L-261115-CD34`);
  });
});

describe("share helpers", () => {
  it("link text follows SPEC §5.1 and wa.me carries it encoded, without a phone number", () => {
    const t = linkShareText("DC-000125", "https://dulcecalle.vercel.app/cliente/comprobante/abc_-1");
    expect(t).toBe("Tu comprobante DC-000125: https://dulcecalle.vercel.app/cliente/comprobante/abc_-1");
    expect(whatsappHref(t)).toBe(`https://wa.me/?text=${encodeURIComponent(t)}`);
  });

  it("mapReceiptRefs keeps only well-formed refs; shareableReceipt picks the op's own kind", () => {
    const refs = mapReceiptRefs([SALE_R, { id: 5 }, null, { id: "r-2", kind: "allocation", number: "DC-000125/D1", verifyCode: "X" }]);
    expect(refs).toEqual([SALE_R, { id: "r-2", kind: "allocation", number: "DC-000125/D1", verifyCode: "X" }]);
    expect(mapReceiptRefs("nope")).toBeUndefined();
    expect(shareableReceipt(refs, "sale")).toEqual(SALE_R);
    expect(shareableReceipt(refs, "payment")).toBeNull();
    expect(shareableReceipt(undefined, "sale")).toBeNull();
  });
});
