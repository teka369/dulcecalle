import { describe, expect, it } from "vitest";
import { syncOperationNotes } from "./sync-copy";

/** loop/v1 verify-A1-A3 (minor): no «reintenta» copy when the row offers no Reintentar. */
describe("syncOperationNotes without Reintentar", () => {
  const base = { status: "failed" as const, localCreatedAt: 1, attempts: 1, nextAttemptAt: null };
  it("orphan (canRetry false) does not suggest retrying", () => {
    const lines = syncOperationNotes({ ...base, canRetry: false }).join(" ");
    expect(lines).not.toMatch(/reintent/i);
    expect(lines).toMatch(/Descártala/);
  });
  it("retryable failure keeps the retry hint", () => {
    expect(syncOperationNotes({ ...base, canRetry: true }).join(" ")).toMatch(/reintenta si corresponde/);
  });
});
