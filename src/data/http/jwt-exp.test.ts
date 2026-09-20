import { describe, expect, it } from "vitest";
import { jwtExpIsPast, readJwtExpSeconds } from "./jwt-exp";

function b64url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function unsignedJwt(payload: unknown): string {
  return `${b64url('{"alg":"none","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("readJwtExpSeconds / jwtExpIsPast", () => {
  it("reads numeric exp as Unix seconds", () => {
    const exp = nowSec() + 3_600;
    expect(readJwtExpSeconds(unsignedJwt({ exp }))).toBe(exp);
    expect(jwtExpIsPast(unsignedJwt({ exp }))).toBe(false);
  });

  it("treats past numeric exp as expired", () => {
    const exp = nowSec() - 3_600;
    expect(readJwtExpSeconds(unsignedJwt({ exp }))).toBe(exp);
    expect(jwtExpIsPast(unsignedJwt({ exp }))).toBe(true);
  });

  it("interprets exp as seconds, not milliseconds", () => {
    const exp = nowSec() + 60;
    const token = unsignedJwt({ exp });
    expect(readJwtExpSeconds(token)).toBe(exp);
    // If exp were treated as ms it would be ~1970 and count as past.
    expect(jwtExpIsPast(token)).toBe(false);
    expect(jwtExpIsPast(unsignedJwt({ exp: nowSec() - 60 }))).toBe(true);
  });

  it("does not mark non-JWT or malformed tokens as expired", () => {
    expect(readJwtExpSeconds("r1")).toBeNull();
    expect(jwtExpIsPast("r1")).toBe(false);
    expect(jwtExpIsPast("expired")).toBe(false);
    expect(jwtExpIsPast("a.b")).toBe(false);
    expect(jwtExpIsPast("a.b.c.d")).toBe(false);
    expect(jwtExpIsPast("header..sig")).toBe(false);
    expect(jwtExpIsPast(`${b64url("x")}.${b64url("!!!")}.sig`)).toBe(false);
    expect(jwtExpIsPast(`${b64url("x")}.${b64url("{")}.sig`)).toBe(false);
  });

  it("payload without numeric exp is not expired", () => {
    expect(jwtExpIsPast(unsignedJwt({ sub: "u1" }))).toBe(false);
    expect(jwtExpIsPast(unsignedJwt({ exp: "9999999999" }))).toBe(false);
    expect(jwtExpIsPast(unsignedJwt({ exp: null }))).toBe(false);
    expect(jwtExpIsPast(unsignedJwt({ exp: true }))).toBe(false);
    expect(readJwtExpSeconds(unsignedJwt([1, 2, 3]))).toBeNull();
  });
});
