import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import type { CustomerLedger } from "../http/customer-api";
import {
  getCustomerAuthSession,
  resetCustomerAuthSessionForTests,
} from "../http/customer-session";
import { loadCachedCustomerLedger } from "./customer-ledger-cache";

const api = { ledger: vi.fn() };

vi.mock("../http/customer-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http/customer-api")>();
  return { ...actual, getCustomerApi: () => api };
});

const CUSTOMER_A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "DC-0001", name: "Rosa" };
const CUSTOMER_B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "DC-0002", name: "Luis" };

function ledger(debt = 0): CustomerLedger {
  return {
    customer: { id: CUSTOMER_A.id, code: "DC-0001", name: "Rosa", debt, createdAt: 1 },
    initials: [],
    sales: [],
    payments: [],
  };
}

function loginAs(customer: { id: string; code: string; name: string }) {
  getCustomerAuthSession().customer = customer;
}

describe("M6.10 customer ledger cache", () => {
  beforeEach(async () => {
    resetCustomerAuthSessionForTests();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    loginAs(CUSTOMER_A);
  });

  it("1. successful online ledger is saved to cache", async () => {
    api.ledger.mockResolvedValue(ledger(5000));
    const result = await loadCachedCustomerLedger();
    expect(result.source).toBe("server");
    expect(result.ledger.customer.debt).toBe(5000);
    const row = await getLocalDb().customerLedgers.get(CUSTOMER_A.id);
    expect(row?.ledger.customer.debt).toBe(5000);
    expect(row?.capturedAt).toBe(result.capturedAt);
  });

  it("2. offline with cache serves the stored snapshot", async () => {
    api.ledger.mockResolvedValueOnce(ledger(5000));
    const first = await loadCachedCustomerLedger();
    api.ledger.mockRejectedValue(new NetworkError("offline"));
    const result = await loadCachedCustomerLedger();
    expect(result.source).toBe("cache");
    expect(result.ledger.customer.debt).toBe(5000);
    expect(result.capturedAt).toBe(first.capturedAt);
  });

  it("3. offline without cache rethrows without inventing data", async () => {
    const offline = new NetworkError("offline");
    api.ledger.mockRejectedValue(offline);
    await expect(loadCachedCustomerLedger()).rejects.toBe(offline);
    expect(await getLocalDb().customerLedgers.get(CUSTOMER_A.id)).toBeUndefined();
  });

  it("4. an empty online ledger is cached and distinct from never-cached", async () => {
    api.ledger.mockResolvedValue(ledger(0));
    await loadCachedCustomerLedger();
    expect(await getLocalDb().customerLedgers.get(CUSTOMER_A.id)).not.toBeUndefined();
    api.ledger.mockRejectedValue(new NetworkError("offline"));
    const result = await loadCachedCustomerLedger();
    expect(result.source).toBe("cache");
    expect(result.ledger.sales).toEqual([]);
  });

  it("5. customer A cannot read customer B cache", async () => {
    api.ledger.mockResolvedValue(ledger(5000));
    await loadCachedCustomerLedger();
    loginAs(CUSTOMER_B);
    const offline = new NetworkError("offline");
    api.ledger.mockRejectedValue(offline);
    await expect(loadCachedCustomerLedger()).rejects.toBe(offline);
  });

  it("6. a new customer gets no cache from the previous one", async () => {
    api.ledger.mockResolvedValue(ledger(5000));
    await loadCachedCustomerLedger();
    loginAs(CUSTOMER_B);
    api.ledger.mockResolvedValue(ledger(0));
    const result = await loadCachedCustomerLedger();
    expect(result.source).toBe("server");
    // A's snapshot is untouched and still keyed by A.
    expect((await getLocalDb().customerLedgers.get(CUSTOMER_A.id))?.ledger.customer.debt).toBe(5000);
    expect((await getLocalDb().customerLedgers.get(CUSTOMER_B.id))?.ledger.customer.debt).toBe(0);
  });

  it("7. logout removes that customer cache", async () => {
    const { CustomerApi } = await import("../http/customer-api");
    api.ledger.mockResolvedValue(ledger(5000));
    await loadCachedCustomerLedger();
    const session = getCustomerAuthSession();
    const client = new CustomerApi(
      "http://127.0.0.1:9",
      session,
      (() => Promise.reject(new NetworkError("offline"))) as typeof fetch,
    );
    await client.logout();
    expect(session.customer).toBeNull();
    expect(await getLocalDb().customerLedgers.get(CUSTOMER_A.id)).toBeUndefined();
  });

  it("8. a new online fetch replaces the previous cache", async () => {
    api.ledger.mockResolvedValueOnce(ledger(5000));
    await loadCachedCustomerLedger();
    api.ledger.mockResolvedValueOnce(ledger(1200));
    const result = await loadCachedCustomerLedger();
    expect(result.source).toBe("server");
    expect(result.ledger.customer.debt).toBe(1200);
    expect((await getLocalDb().customerLedgers.get(CUSTOMER_A.id))?.ledger.customer.debt).toBe(1200);
  });

  it("9. capture time updates on every online fetch", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1000);
    api.ledger.mockResolvedValueOnce(ledger(0));
    const first = await loadCachedCustomerLedger();
    now.mockReturnValueOnce(2000);
    api.ledger.mockResolvedValueOnce(ledger(0));
    const second = await loadCachedCustomerLedger();
    expect(first.capturedAt).toBe(1000);
    expect(second.capturedAt).toBe(2000);
  });

  it("10. an HTTP error is rethrown, never served from cache", async () => {
    api.ledger.mockResolvedValueOnce(ledger(5000));
    await loadCachedCustomerLedger();
    const serverError = new ApiError("INTERNAL", "Falla el servidor.", 500);
    api.ledger.mockRejectedValue(serverError);
    await expect(loadCachedCustomerLedger()).rejects.toBe(serverError);
  });
});
