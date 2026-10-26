import { describe, expect, it } from "vitest";
import { portalLink, storeCode } from "./store-code";

describe("store code / portal link", () => {
  it("store code = first 8 of the id, uppercase", () => {
    expect(storeCode("3f9a1c2e-1111-4222-8333-444455556666")).toBe("3F9A1C2E");
  });
  it("absolute link from the current origin, with ?tienda=<businessId>", () => {
    expect(portalLink("https://dulcecalle.vercel.app/", "3f9a1c2e-1111-4222-8333-444455556666")).toBe(
      "https://dulcecalle.vercel.app/cliente/login?tienda=3f9a1c2e-1111-4222-8333-444455556666",
    );
  });
});
