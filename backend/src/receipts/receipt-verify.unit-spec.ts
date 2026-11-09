import { verifyThrottleTtl } from "./receipt-verify.controller";
import { normalizeVerifyCode } from "./receipts.service";
import { linkState } from "./receipt-links.service";

describe("C09-PR5 verify/link helpers", () => {
  it("VERIFY_THROTTLE_TTL_MS never shortens the 60 s window in production", () => {
    expect(verifyThrottleTtl({ NODE_ENV: "production", VERIFY_THROTTLE_TTL_MS: "1000" })).toBe(60000);
    expect(verifyThrottleTtl({ NODE_ENV: "test", VERIFY_THROTTLE_TTL_MS: "1000" })).toBe(1000);
    expect(verifyThrottleTtl({ NODE_ENV: "test", VERIFY_THROTTLE_TTL_MS: "abc" })).toBe(60000);
    expect(verifyThrottleTtl({})).toBe(60000);
  });

  it("normalizes manual entry XXXX-XXXX-XX and rejects anything outside the alphabet", () => {
    expect(normalizeVerifyCode("abcd-efgh-jk")).toBe("ABCDEFGHJK");
    expect(normalizeVerifyCode(" 2345 6789 AB ")).toBe("23456789AB");
    for (const bad of ["", "short", "0O1IL0O1IL", "ABCDEFGHJKL", "ABCD_EFGHJ"]) expect(normalizeVerifyCode(bad)).toBeNull();
  });

  it("link state: revoked > used > expired > active", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const later = new Date("2026-11-10T12:00:00Z");
    const past = new Date("2026-11-08T12:00:00Z");
    expect(linkState({ revokedAt: now, usedAt: now, expiresAt: past }, now)).toBe("revoked");
    expect(linkState({ revokedAt: null, usedAt: now, expiresAt: past }, now)).toBe("used");
    expect(linkState({ revokedAt: null, usedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(linkState({ revokedAt: null, usedAt: null, expiresAt: later }, now)).toBe("active");
  });
});
