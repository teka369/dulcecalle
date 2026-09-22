import { describe, expect, it } from "vitest";
import { HttpRepository } from "./repository";
import { HttpSession } from "./session";
import type { AuthStorage } from "./session";

function memoryStorage(): AuthStorage {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function imageRow() {
  return {
    id: "44444444-4444-4333-8333-444444444444",
    productId: PRODUCT_ID,
    publicId: `dulcecalle/biz/products/${PRODUCT_ID}/${REQUEST_ID}`,
    secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg",
    version: 1,
    width: 800,
    height: 600,
    format: "jpg",
    bytes: 1000,
    position: 0,
    isPrimary: true,
    altText: null,
    createdAt: "2026-09-22T12:00:00.000Z",
  };
}

function captureFetch(responseBody: unknown) {
  let url = "";
  let headers: Record<string, string> = {};
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    headers = (init?.headers ?? {}) as Record<string, string>;
    body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    return jsonResponse(201, responseBody);
  };
  return {
    fetchImpl,
    sent: () => ({ url, headers, body }),
  };
}

function repoWith(captured: ReturnType<typeof captureFetch>) {
  const session = new HttpSession(memoryStorage());
  session.accessToken = "acc";
  session.refreshToken = "ref";
  session.businessId = "11111111-1111-4111-8111-111111111111";
  return new HttpRepository("http://example.test/v1", session, captured.fetchImpl);
}

describe("HttpRepository product image contract", () => {
  it("registerImage sends requestId in body AND Idempotency-Key header", async () => {
    // Production incident 2026-09-22: the body omitted requestId, so the
    // backend answered 400 "requestId must be a UUID" on every register and
    // the UI showed "0 de 1 fotos cargadas". Both fields carry the SAME uuid.
    const captured = captureFetch(imageRow());
    const repo = repoWith(captured);
    const input = {
      publicId: `dulcecalle/biz/products/${PRODUCT_ID}/${REQUEST_ID}`,
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg",
      resourceType: "image",
    };
    const image = await repo.products.registerImage(PRODUCT_ID, input, REQUEST_ID);
    const { url, headers, body } = captured.sent();
    expect(url).toBe(`http://example.test/v1/products/${PRODUCT_ID}/images`);
    expect(body.requestId).toBe(REQUEST_ID);
    expect(headers["Idempotency-Key"]).toBe(REQUEST_ID);
    expect(body).toMatchObject({ publicId: input.publicId });
    expect(image.id).toBe("44444444-4444-4333-8333-444444444444");
  });

  it("imageSignature sends requestId in body AND Idempotency-Key header", async () => {
    const captured = captureFetch({
      cloudName: "demo",
      apiKey: "key123",
      uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
      timestamp: 1700000000,
      signature: "sig",
      publicId: "dulcecalle/biz/products/p/r",
      requestId: REQUEST_ID,
    });
    const repo = repoWith(captured);
    await repo.products.imageSignature(PRODUCT_ID, REQUEST_ID);
    const { url, headers, body } = captured.sent();
    expect(url).toBe(`http://example.test/v1/products/${PRODUCT_ID}/image-signature`);
    expect(body.requestId).toBe(REQUEST_ID);
    expect(headers["Idempotency-Key"]).toBe(REQUEST_ID);
  });
});
