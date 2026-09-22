import { describe, expect, it } from "vitest";
import {
  MAX_IMAGES_PER_PRODUCT,
  MAX_IMAGE_BYTES,
  imageErrorMessage,
  validateImageFile,
} from "./validate";
import { primaryImage, sortImages, transformUrl, variantUrl } from "./urls";

function file(name: string, type: string, size: number): Pick<File, "name" | "size" | "type"> {
  return { name, type, size };
}

describe("validateImageFile", () => {
  it("accepts jpeg/png/webp within limits", () => {
    expect(validateImageFile(file("a.jpg", "image/jpeg", 100))).toEqual({
      ok: true,
      ext: "jpg",
    });
    expect(validateImageFile(file("a.jpeg", "image/jpeg", 100)).ok).toBe(true);
    expect(validateImageFile(file("a.PNG", "image/png", 100))).toEqual({
      ok: true,
      ext: "png",
    });
    expect(validateImageFile(file("a.webp", "image/webp", 100))).toEqual({
      ok: true,
      ext: "webp",
    });
  });

  it("rejects wrong mime, spoofed extension, oversize and empty", () => {
    expect(validateImageFile(file("a.gif", "image/gif", 100))).toEqual({
      ok: false,
      error: "type",
    });
    expect(validateImageFile(file("a.png", "image/jpeg", 100))).toEqual({
      ok: false,
      error: "type",
    });
    expect(
      validateImageFile(file("a.jpg", "image/jpeg", MAX_IMAGE_BYTES + 1)),
    ).toEqual({ ok: false, error: "size" });
    expect(validateImageFile(file("a.jpg", "image/jpeg", 0))).toEqual({
      ok: false,
      error: "empty",
    });
  });

  it("documents limits and human messages", () => {
    expect(MAX_IMAGES_PER_PRODUCT).toBe(8);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(imageErrorMessage("type")).toContain("JPG");
    expect(imageErrorMessage("size")).toContain("5 MB");
  });
});

describe("delivery urls", () => {
  const base =
    "https://res.cloudinary.com/demo/image/upload/v1/dulcecalle/x.jpg";

  it("inserts exactly one transformation", () => {
    expect(variantUrl(base, "thumb")).toBe(
      "https://res.cloudinary.com/demo/image/upload/w_160,h_160,c_fill,q_auto,f_auto/v1/dulcecalle/x.jpg",
    );
    expect(variantUrl(base, "card")).toContain("/w_640,c_limit,q_auto,f_auto/");
    expect(variantUrl(base, "detail")).toContain("/w_1200,c_limit,q_auto,f_auto/");
  });

  it("never double-transforms and passes through unknown hosts", () => {
    const once = transformUrl(base, "w_100");
    expect(transformUrl(once, "w_200")).toBe(once);
    expect(transformUrl("https://example.com/a.jpg", "w_100")).toBe(
      "https://example.com/a.jpg",
    );
  });

  it("sorts primary first then position", () => {
    const rows = [
      { isPrimary: false, position: 0 },
      { isPrimary: false, position: 1 },
      { isPrimary: true, position: 5 },
    ];
    expect(sortImages(rows).map((r) => r.position)).toEqual([5, 0, 1]);
    expect(primaryImage(rows)).toEqual({ isPrimary: true, position: 5 });
    expect(primaryImage([])).toBeNull();
  });
});
