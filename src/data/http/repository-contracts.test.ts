import { describe, expect, it } from "vitest";
import { HttpRepository } from "./repository";
import { HttpSession } from "./session";
import type { AuthStorage } from "./session";

function memoryStorage(): AuthStorage {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQUEST = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MOVE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function captureRepo(responseBody: unknown) {
  let url = "";
  let headers: Record<string, string> = {};
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    headers = (init?.headers ?? {}) as Record<string, string>;
    body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    return jsonResponse(201, responseBody);
  };
  const session = new HttpSession(memoryStorage());
  session.accessToken = "acc";
  session.refreshToken = "ref";
  session.businessId = "11111111-1111-4111-8111-111111111111";
  return {
    repo: new HttpRepository("http://example.test/v1", session, fetchImpl),
    sent: () => ({ url, headers, body }),
  };
}

function stockMove(reason: string) {
  return {
    id: MOVE,
    productId: PRODUCT,
    delta: reason === "surtir" ? 2 : -1,
    reason,
    unitCost: 1310,
    supplierId: SUPPLIER,
    note: null,
    occurredOn: "2026-09-23",
    createdAt: "2026-09-23T12:00:00.000Z",
  };
}

describe("HttpRepository body contracts vs Nest whitelist", () => {
  it("surtir keeps productId in the path and drops it from the body", async () => {
    const captured = captureRepo(stockMove("surtir"));
    await captured.repo.inventory.surtir(
      PRODUCT,
      {
        productId: PRODUCT,
        qty: 2,
        unitCost: 1310,
        totalCost: 2620,
        method: "Efectivo",
        supplierId: SUPPLIER,
      },
      REQUEST,
    );
    const { url, headers, body } = captured.sent();
    expect(url).toBe(`http://example.test/v1/products/${PRODUCT}/surtir`);
    expect(headers["Idempotency-Key"]).toBe(REQUEST);
    expect(body).toEqual({
      qty: 2,
      unitCost: 1310,
      totalCost: 2620,
      method: "Efectivo",
      supplierId: SUPPLIER,
    });
    expect(body).not.toHaveProperty("productId");
  });

  it("shrink drops productId from the body on sync replay payloads", async () => {
    const captured = captureRepo(stockMove("me_lo_comi"));
    await captured.repo.inventory.shrink(
      PRODUCT,
      { productId: PRODUCT, qty: 1, reason: "me_lo_comi" },
      REQUEST,
    );
    const { url, body } = captured.sent();
    expect(url).toBe(`http://example.test/v1/products/${PRODUCT}/shrink`);
    expect(body).toEqual({ qty: 1, reason: "me_lo_comi" });
    expect(body).not.toHaveProperty("productId");
  });

  it("product patch drops outbox id from the body", async () => {
    const captured = captureRepo({
      id: PRODUCT,
      name: "Galletas",
      price: 2000,
      avgCost: 1310,
      stock: 4,
      lowStockAt: 2,
      sellable: true,
      archivedAt: null,
      createdAt: "2026-09-23T12:00:00.000Z",
      images: [],
    });
    await captured.repo.products.patch(
      PRODUCT,
      { id: PRODUCT, name: "Galletas", price: 2000 },
      REQUEST,
    );
    const { url, body } = captured.sent();
    expect(url).toBe(`http://example.test/v1/products/${PRODUCT}`);
    expect(body).toEqual({ name: "Galletas", price: 2000 });
    expect(body).not.toHaveProperty("id");
  });

  it("customer patch drops outbox id from the body", async () => {
    const captured = captureRepo({
      id: CUSTOMER,
      code: "DC-0001",
      name: "Ana",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: "2026-09-23T12:00:00.000Z",
    });
    await captured.repo.customers.patch(CUSTOMER, { id: CUSTOMER, name: "Ana" }, REQUEST);
    const { body } = captured.sent();
    expect(body).toEqual({ name: "Ana" });
    expect(body).not.toHaveProperty("id");
  });

  it("supplier patch drops outbox id from the body", async () => {
    const captured = captureRepo({
      id: SUPPLIER,
      name: "Aquí dulcería",
      phone: null,
      notes: null,
      createdAt: "2026-09-23T12:00:00.000Z",
    });
    await captured.repo.suppliers.patch(
      SUPPLIER,
      { id: SUPPLIER, name: "Aquí dulcería" },
      REQUEST,
    );
    const { body } = captured.sent();
    expect(body).toEqual({ name: "Aquí dulcería" });
    expect(body).not.toHaveProperty("id");
  });

  it("aporte and retiro drop outbox kind from the body", async () => {
    const move = {
      id: MOVE,
      amount: 5000,
      direction: "in",
      method: "Efectivo",
      kind: "aporte",
      refType: null,
      refId: null,
      occurredOn: "2026-09-23",
      createdAt: "2026-09-23T12:00:00.000Z",
    };
    const aporte = captureRepo(move);
    await aporte.repo.cash.aporte(
      { kind: "aporte", amount: 5000, method: "Efectivo" },
      REQUEST,
    );
    expect(aporte.sent().url).toBe("http://example.test/v1/cash/aportes");
    expect(aporte.sent().body).toEqual({ amount: 5000, method: "Efectivo" });
    expect(aporte.sent().body).not.toHaveProperty("kind");

    const retiro = captureRepo({ ...move, direction: "out", kind: "retiro" });
    await retiro.repo.cash.retiro(
      { kind: "retiro", amount: 5000, method: "Nequi", note: "casa" },
      REQUEST,
    );
    expect(retiro.sent().url).toBe("http://example.test/v1/cash/retiros");
    expect(retiro.sent().body).toEqual({
      amount: 5000,
      method: "Nequi",
      note: "casa",
    });
    expect(retiro.sent().body).not.toHaveProperty("kind");
  });
});
