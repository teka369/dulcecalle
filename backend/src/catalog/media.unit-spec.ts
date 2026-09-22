import { createHash } from "node:crypto";
import {
  deliveryUrl,
  imagePublicId,
  parseImagePublicId,
  readCloudinaryConfig,
  signUploadParams,
} from "./media.service";

describe("media pure helpers", () => {
  it("signs exactly timestamp+public_id per Cloudinary docs", () => {
    const secret = "abcd";
    const params = { public_id: "sample_image", timestamp: 1315060510 };
    const expected = createHash("sha1")
      .update("public_id=sample_image&timestamp=1315060510" + secret)
      .digest("hex");
    expect(signUploadParams(params, secret)).toBe(expected);
  });

  it("signs timestamp-only payloads", () => {
    const secret = "abcd";
    const expected = createHash("sha1")
      .update("timestamp=1315060510" + secret)
      .digest("hex");
    expect(signUploadParams({ timestamp: 1315060510 }, secret)).toBe(expected);
  });

  it("sorts signed params alphabetically", () => {
    const a = signUploadParams(
      { timestamp: 1, public_id: "x", eager: "w_1" },
      "s",
    );
    const b = signUploadParams(
      { eager: "w_1", public_id: "x", timestamp: 1 },
      "s",
    );
    expect(a).toBe(b);
  });

  it("builds deterministic tenant-scoped public ids", () => {
    const biz = "11111111-1111-4111-8111-111111111111";
    const prod = "22222222-2222-4222-8222-222222222222";
    const req = "33333333-3333-4333-8333-333333333333";
    const publicId = imagePublicId(biz, prod, req);
    expect(publicId).toBe(`dulcecalle/${biz}/products/${prod}/${req}`);
    expect(parseImagePublicId(publicId)).toEqual({
      businessId: biz,
      productId: prod,
      requestId: req,
    });
  });

  it("rejects foreign or malformed public ids", () => {
    expect(parseImagePublicId("other/biz/products/x/y")).toBeNull();
    expect(parseImagePublicId("dulcecalle/not-a-uuid/products/x/y")).toBeNull();
    expect(parseImagePublicId("dulcecalle/a/b")).toBeNull();
    expect(parseImagePublicId("")).toBeNull();
  });

  it("builds delivery URLs with a single transformation", () => {
    expect(deliveryUrl("demo", "dulcecalle/x", "jpg", "w_160,h_160,c_fill")).toBe(
      "https://res.cloudinary.com/demo/image/upload/w_160,h_160,c_fill/dulcecalle/x.jpg",
    );
    expect(deliveryUrl("demo", "dulcecalle/x", null)).toBe(
      "https://res.cloudinary.com/demo/image/upload/dulcecalle/x",
    );
    expect(deliveryUrl("demo", "dulcecalle/x", "jpg")).toBe(
      "https://res.cloudinary.com/demo/image/upload/dulcecalle/x.jpg",
    );
  });

  it("requires all three server env vars, exposes nothing", () => {
    expect(
      readCloudinaryConfig({} as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      readCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: "c",
        CLOUDINARY_API_KEY: "k",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      readCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: "c",
        CLOUDINARY_API_KEY: "k",
        CLOUDINARY_API_SECRET: "s",
      } as NodeJS.ProcessEnv),
    ).toEqual({ cloudName: "c", apiKey: "k", apiSecret: "s" });
  });
});
