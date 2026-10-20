import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { resetOutboxStoreSingleton } from "@/data/local/outbox";

const BIZ = "11111111-1111-4111-8111-111111111111";
const MOVE = "22222222-2222-4222-8222-222222222222";
const SESS = "33333333-3333-4333-8333-333333333333";
const api = { cash: { assignMove: vi.fn() } };
vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => ({ businessId: BIZ }) }));

/** loop/v1 verify-A1-A3 (minor): a network failure on A3 says the connection failed, not «no está en este negocio». */
describe("assignMoveWithOfflineFallback network copy", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    await __resetLocalDbForTests();
    api.cash.assignMove.mockRejectedValue(new NetworkError("Sin conexión."));
  });

  it("move not cached locally + network error → connection message", async () => {
    const { assignMoveWithOfflineFallback } = await import("./offline-operations");
    const err = await assignMoveWithOfflineFallback(MOVE, SESS).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/no está en este negocio/);
    expect((err as Error).message).toMatch(/conexión/i);
  });

  it("move cached but from another business keeps «no está en este negocio»", async () => {
    await getLocalDb().cashMoves.put({ id: MOVE, businessId: "44444444-4444-4444-8444-444444444444", sessionId: null } as never);
    const { assignMoveWithOfflineFallback } = await import("./offline-operations");
    const err = await assignMoveWithOfflineFallback(MOVE, SESS).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/no está en este negocio/);
  });
});
