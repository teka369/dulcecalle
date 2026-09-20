import { describe, expect, it, vi } from "vitest";
import { loadHttpStatement } from "./statement";

const api = { customers: { ledger: vi.fn() } };

vi.mock("./api", () => ({ getPwaApi: () => api }));

describe("loadHttpStatement payment note", () => {
  it("carries the abono note into the statement entry", async () => {
    api.customers.ledger.mockResolvedValue({
      customer: {
        id: "11111111-1111-4111-8111-111111111111",
        code: "DC-0001",
        name: "Rosa",
        phone: null,
        debt: 4000,
        archivedAt: null,
        createdAt: "2026-09-17T12:00:00.000Z",
      },
      initials: [],
      sales: [],
      payments: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          customerId: "11111111-1111-4111-8111-111111111111",
          amount: 1000,
          method: "Efectivo",
          note: "abono semanal",
          occurredOn: "2026-09-17",
          createdAt: "2026-09-17T12:00:00.000Z",
        },
      ],
    });
    const statement = await loadHttpStatement("11111111-1111-4111-8111-111111111111");
    expect(statement).not.toBeNull();
    const abono = statement?.entries.find((e) => e.kind === "abono");
    expect(abono).toMatchObject({ amount: 1000, note: "abono semanal" });
  });
});
