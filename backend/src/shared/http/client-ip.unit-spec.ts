import { clientIp, clientIpHeader, isPrivatePeer } from "./client-ip";

/** C09-PR5.1 — when the Cloudflare client-IP header is trusted, and when it is not. */
describe("clientIp", () => {
  const behindRender = (headers: Record<string, string | string[]>, ip = "104.22.17.40") => ({
    ip,
    headers,
    socket: { remoteAddress: "10.21.157.68" },
  });

  it("uses CF-Connecting-IP when the request came through the private proxy hop", () => {
    expect(clientIp(behindRender({ "cf-connecting-ip": "203.0.113.7" }), {})).toBe("203.0.113.7");
    expect(clientIp(behindRender({ "cf-connecting-ip": "2001:db8::7" }), {})).toBe("2001:db8::7");
  });

  it("ignores the header from a public socket peer (no proxy in front: the client could set it)", () => {
    const direct = { ip: "198.51.100.5", headers: { "cf-connecting-ip": "203.0.113.7" }, socket: { remoteAddress: "198.51.100.5" } };
    expect(clientIp(direct, {})).toBe("198.51.100.5");
  });

  it("ignores lists, garbage, repeated headers and a missing header (falls back to req.ip)", () => {
    expect(clientIp(behindRender({ "cf-connecting-ip": "203.0.113.7, 198.51.100.1" }), {})).toBe("104.22.17.40");
    expect(clientIp(behindRender({ "cf-connecting-ip": "not-an-ip" }), {})).toBe("104.22.17.40");
    expect(clientIp(behindRender({ "cf-connecting-ip": ["203.0.113.7", "203.0.113.8"] }), {})).toBe("104.22.17.40");
    expect(clientIp(behindRender({}), {})).toBe("104.22.17.40");
  });

  it("never reads X-Forwarded-For or True-Client-IP by default", () => {
    expect(clientIp(behindRender({ "x-forwarded-for": "6.6.6.6", "true-client-ip": "7.7.7.7" }), {})).toBe("104.22.17.40");
  });

  it("CLIENT_IP_HEADER=off restores plain req.ip; another header name can be configured", () => {
    expect(clientIpHeader({ CLIENT_IP_HEADER: "off" })).toBeNull();
    expect(clientIp(behindRender({ "cf-connecting-ip": "203.0.113.7" }), { CLIENT_IP_HEADER: "off" })).toBe("104.22.17.40");
    expect(clientIp(behindRender({ "true-client-ip": "203.0.113.9" }), { CLIENT_IP_HEADER: "True-Client-IP" })).toBe("203.0.113.9");
  });

  it("C09-PR5.2 (T02): a public peer is keyed by its socket IP even if req.ip came from a forged XFF", () => {
    const forged = { ip: "45.160.0.7", headers: { "x-forwarded-for": "45.160.0.7", "cf-connecting-ip": "203.0.113.7" }, socket: { remoteAddress: "198.51.100.78" } };
    expect(clientIp(forged, {})).toBe("198.51.100.78");
    expect(clientIp({ ...forged, socket: { remoteAddress: "::ffff:198.51.100.78" } }, {})).toBe("198.51.100.78");
  });

  it("private peers", () => {
    for (const a of ["10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "::1", "::ffff:10.0.0.1", "100.64.0.1", "fd12::1"]) expect(isPrivatePeer(a)).toBe(true);
    for (const a of ["104.22.17.40", "203.0.113.7", "2001:db8::1", undefined]) expect(isPrivatePeer(a)).toBe(false);
  });
});
