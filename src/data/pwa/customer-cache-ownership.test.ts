import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import type { CustomerLedger } from "../http/customer-api";
import { getCustomerAuthSession, resetCustomerAuthSessionForTests } from "../http/customer-session";
import { loadCachedCustomerLedger, ForeignLedgerError } from "./customer-ledger-cache";
import { loadCachedCustomerCatalog } from "./customer-catalog-cache";

const api = { ledger: vi.fn(), products: vi.fn() };
vi.mock("../http/customer-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http/customer-api")>();
  return { ...actual, getCustomerApi: () => api };
});

const A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "DC-0001", name: "Rosa" };
const B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "DC-0002", name: "Luis" };

function ledgerFor(id: string, debt = 1000): CustomerLedger {
  return { customer: { id, code: "X", name: "X", debt, createdAt: 1 }, initials: [], sales: [], payments: [] };
}
const PRODUCTS = [{ id: "p1", name: "Arequipe", price: 2000, available: true, images: [] }];

describe("privacy 4a: portal caches only verified own data", () => {
  beforeEach(async () => {
    resetCustomerAuthSessionForTests();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    getCustomerAuthSession().customer = A;
  });

  it("ledger mismatch => nothing written, rejects, no foreign data returned", async () => {
    api.ledger.mockResolvedValue(ledgerFor(B.id));
    await expect(loadCachedCustomerLedger()).rejects.toBeInstanceOf(ForeignLedgerError);
    expect(await getLocalDb().customerLedgers.count()).toBe(0);
  });

  it("ledger mismatch does not fall back to an existing own cache row being overwritten", async () => {
    api.ledger.mockResolvedValueOnce(ledgerFor(A.id, 5000));
    await loadCachedCustomerLedger();
    api.ledger.mockResolvedValueOnce(ledgerFor(B.id, 9999));
    await expect(loadCachedCustomerLedger()).rejects.toBeInstanceOf(ForeignLedgerError);
    const row = await getLocalDb().customerLedgers.get(A.id);
    expect(row?.ledger.customer.debt).toBe(5000);
    expect(await getLocalDb().customerLedgers.get(B.id)).toBeUndefined();
  });

  it("ledger: session switched mid-request => nothing written", async () => {
    api.ledger.mockImplementation(async () => {
      getCustomerAuthSession().customer = B;
      return ledgerFor(A.id);
    });
    await expect(loadCachedCustomerLedger()).rejects.toBeInstanceOf(ForeignLedgerError);
    expect(await getLocalDb().customerLedgers.count()).toBe(0);
  });

  it("ledger match => cached as before", async () => {
    api.ledger.mockResolvedValue(ledgerFor(A.id, 4200));
    const r = await loadCachedCustomerLedger();
    expect(r.source).toBe("server");
    expect((await getLocalDb().customerLedgers.get(A.id))?.ledger.customer.debt).toBe(4200);
  });

  it("catalog: session mismatch => nothing written to portalCatalogs", async () => {
    api.products.mockImplementation(async () => {
      getCustomerAuthSession().customer = B;
      return PRODUCTS;
    });
    await expect(loadCachedCustomerCatalog()).rejects.toThrow();
    expect(await getLocalDb().portalCatalogs.count()).toBe(0);
  });

  it("catalog match => cached as before", async () => {
    api.products.mockResolvedValue(PRODUCTS);
    const r = await loadCachedCustomerCatalog();
    expect(r.source).toBe("server");
    expect((await getLocalDb().portalCatalogs.get(A.id))?.products).toHaveLength(1);
  });
});
