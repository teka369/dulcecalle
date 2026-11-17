import { assertTurnstile } from "./turnstile";
import { isPlatformAdminEmail, platformAdminEmails } from "./platform-admin";
import { hashToken, isHoneypot, newEmailToken, tokenHashesEqual } from "./registration-token";

describe("registration policy", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("hashes email tokens and never returns the raw secret as the hash", () => {
    const token = newEmailToken();
    expect(token.raw).toHaveLength(43);
    expect(token.hash).toBe(hashToken(token.raw));
    expect(token.hash).not.toContain(token.raw);
    expect(tokenHashesEqual(token.hash, hashToken(token.raw))).toBe(true);
    expect(tokenHashesEqual(token.hash, hashToken("other-token-value-32bytes-xxxx"))).toBe(false);
  });

  it("treats a filled honeypot as a bot and an empty one as a person", () => {
    expect(isHoneypot("https://spam.test")).toBe(true);
    expect(isHoneypot("  x")).toBe(true);
    expect(isHoneypot("")).toBe(false);
    expect(isHoneypot("   ")).toBe(false);
    expect(isHoneypot(undefined)).toBe(false);
  });

  it("reads platform admins from PLATFORM_ADMIN_EMAILS only", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " Admin@Dulce.test , other@dulce.test ";
    expect(platformAdminEmails()).toEqual(new Set(["admin@dulce.test", "other@dulce.test"]));
    expect(isPlatformAdminEmail("admin@dulce.test")).toBe(true);
    expect(isPlatformAdminEmail("nope@dulce.test")).toBe(false);
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdminEmail("admin@dulce.test")).toBe(false);
  });

  it("skips Turnstile when no secret is configured", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    await expect(assertTurnstile(undefined)).resolves.toBeUndefined();
  });

  it("requires a successful Turnstile token when the secret is set", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    await expect(assertTurnstile(undefined)).rejects.toMatchObject({ code: "VALIDATION" });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ success: false }), { status: 200 })) as typeof fetch;
    await expect(assertTurnstile("tok", process.env, fetchImpl)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const ok = (async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch;
    await expect(assertTurnstile("tok", process.env, ok)).resolves.toBeUndefined();
  });
});
