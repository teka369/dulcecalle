import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { loadDashboardResult } from "./dashboard";

const api = {
  session: { businessId: "11111111-1111-4111-8111-111111111111" },
  products: { list: vi.fn() },
  customers: {
    list: vi.fn(),
    ledger: vi.fn(),
  },
  sales: {
    list: vi.fn(),
    returns: vi.fn(),
  },
  cash: { today: vi.fn() },
  auth: { me: vi.fn() },
  inventory: { moves: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));

function seedAllOk() {
  api.products.list.mockResolvedValue([]);
  api.customers.list.mockResolvedValue([]);
  api.sales.list.mockResolvedValue([]);
  api.cash.today.mockResolvedValue({ moves: [], session: null });
  api.auth.me.mockResolvedValue(null);
  api.customers.ledger.mockResolvedValue({ customer: {}, initials: [], sales: [], payments: [] });
  api.inventory.moves.mockResolvedValue([]);
  api.sales.returns.mockResolvedValue([]);
}

describe("loadDashboardResult completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedAllOk();
  });

  it("marks complete when every subquery succeeds", async () => {
    const result = await loadDashboardResult();
    expect(result.complete).toBe(true);
    expect(result.networkFailure).toBe(false);
    expect(result.snapshot.emptyDb).toBe(true);
  });

  it("marks partial without network cause on a server subquery failure", async () => {
    api.customers.list.mockResolvedValue([{ id: "c1", name: "Rosa", debt: 0 }]);
    api.customers.ledger.mockRejectedValue(new ApiError("INTERNAL", "Falla.", 500));
    const result = await loadDashboardResult();
    expect(result.complete).toBe(false);
    expect(result.networkFailure).toBe(false);
  });

  it("marks partial with network cause when a subquery loses transport", async () => {
    api.customers.list.mockResolvedValue([{ id: "c1", name: "Rosa", debt: 0 }]);
    api.customers.ledger.mockRejectedValue(new NetworkError("offline"));
    const result = await loadDashboardResult();
    expect(result.complete).toBe(false);
    expect(result.networkFailure).toBe(true);
  });

  it("lets core query failures propagate", async () => {
    const err = new ApiError("INTERNAL", "Falla.", 500);
    api.sales.list.mockRejectedValue(err);
    await expect(loadDashboardResult()).rejects.toBe(err);
  });
});
