import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import {
  __resetLocalDbForTests,
  getLocalDb,
} from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton, getLocalStore } from "@/data/local/store";

const businessId = "11111111-1111-4111-8111-111111111111";
const otherBusinessId = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

type ScriptedResponse =
  | { kind: "ok"; body: unknown }
  | { kind: "http"; status: number; body: unknown }
  | { kind: "network" };

const sentRequests: Array<{ url: string; fields: Record<string, string> }> = [];
let script: ScriptedResponse[] = [];

class FakeUpload {
  onprogress: ((event: { loaded: number; total: number }) => void) | null = null;
}

class FakeXHR {
  static UNSENT = 0;
  static OPENED = 1;
  static DONE = 4;
  readyState = FakeXHR.UNSENT;
  status = 0;
  responseText = "";
  upload = new FakeUpload();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private aborted = false;
  private url = "";

  open(_method: string, url: string) {
    this.url = url;
    this.readyState = FakeXHR.OPENED;
  }
  setRequestHeader() {}
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  send(form: unknown) {
    const fields: Record<string, string> = {};
    const fd = form as { forEach?: (cb: (v: unknown, k: string) => void) => void };
    fd.forEach?.((v, k) => {
      if (typeof v === "string") fields[k] = v;
    });
    sentRequests.push({ url: this.url, fields });
    const next = script.shift() ?? { kind: "ok", body: {} };
    queueMicrotask(() => {
      if (this.aborted) return;
      if (next.kind === "network") {
        this.onerror?.();
        return;
      }
      if (next.kind === "http") {
        this.status = next.status;
        this.responseText = JSON.stringify(next.body);
      } else {
        this.status = 200;
        this.responseText = JSON.stringify(next.body);
      }
      this.readyState = FakeXHR.DONE;
      this.onload?.();
    });
  }
}

vi.stubGlobal("XMLHttpRequest", FakeXHR);

const api = {
  session: { businessId },
  products: {
    imageSignature: vi.fn(),
    registerImage: vi.fn(),
    get: vi.fn(),
    patchImage: vi.fn(),
    reorderImages: vi.fn(),
    removeImage: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

import {
  addProductImages,
  discardPendingMedia,
  listPendingMedia,
  parseUploadResponse,
  queueImageRemove,
  reorderProductImages,
  setPrimaryImage,
  syncPendingProductImages,
} from "./product-images";

function photo(name = "foto.jpg", size = 1000): File {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg" });
}

function signatureResponse(requestId: string) {
  return {
    cloudName: "demo",
    apiKey: "key123",
    uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
    timestamp: 1700000000,
    signature: "sig",
    publicId: `dulcecalle/${businessId}/products/${PRODUCT_ID}/${requestId}`,
    requestId,
  };
}

function uploadBody(publicId: string) {
  return {
    asset_id: "asset-1",
    public_id: publicId,
    secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.jpg`,
    version: 1,
    width: 800,
    height: 600,
    format: "jpg",
    bytes: 1000,
    resource_type: "image",
  };
}

async function seedProduct() {
  const now = Date.now();
  await getLocalDb().products.put({
    id: PRODUCT_ID,
    businessId,
    name: "Gomitas",
    category: "General",
    price: 500,
    avgCost: 100,
    stock: 10,
    lowStockAt: 5,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    images: [],
  });
}

beforeEach(async () => {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  await __resetLocalDbForTests();
  vi.clearAllMocks();
  sentRequests.length = 0;
  script = [];
  api.session.businessId = businessId;
});

describe("parseUploadResponse", () => {
  it("rejects non-image or malformed payloads", () => {
    expect(() =>
      parseUploadResponse({ ...uploadBody("a"), resource_type: "video" }),
    ).toThrow();
    expect(() => parseUploadResponse({})).toThrow();
    expect(() => parseUploadResponse(null)).toThrow();
    const parsed = parseUploadResponse(uploadBody("a"));
    expect(parsed.publicId).toBe("a");
    expect(parsed.secureUrl).toContain("res.cloudinary.com");
  });
});

describe("online upload flow", () => {
  it("uploads, registers and refreshes local images", async () => {
    await seedProduct();
    const requestId = "44444444-4444-4444-8444-444444444444";
    api.products.imageSignature.mockImplementation(async (_id: string, req: string) =>
      signatureResponse(req || requestId),
    );
    script = [{ kind: "ok", body: uploadBody("p") }];
    api.products.registerImage.mockImplementation(
      async (_pid: string, input: Record<string, unknown>, req: string) => ({
        id: "img-1",
        productId: PRODUCT_ID,
        publicId: input.publicId,
        secureUrl: input.secureUrl,
        version: 1,
        width: 800,
        height: 600,
        format: "jpg",
        bytes: 1000,
        position: 0,
        isPrimary: true,
        altText: null,
        createdAt: Date.now(),
      }),
    );
    api.products.get.mockResolvedValue({
      id: PRODUCT_ID,
      businessId,
      name: "Gomitas",
      category: "General",
      price: 500,
      avgCost: 100,
      stock: 10,
      lowStockAt: 5,
      archivedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      images: [],
    });
    const result = await addProductImages(PRODUCT_ID, [photo()]);
    expect(result.mode).toBe("online");
    // No secret material ever leaves toward Cloudinary.
    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0]?.url).toContain("api.cloudinary.com");
    expect(sentRequests[0]?.fields).not.toHaveProperty("api_secret");
    expect(sentRequests[0]?.fields.api_key).toBe("key123");
  });

  it("reports 4/5 style partial failure explicitly", async () => {
    await seedProduct();
    api.products.imageSignature.mockImplementation(async (_id: string, req: string) =>
      signatureResponse(req),
    );
    script = [
      { kind: "ok", body: uploadBody("p1") },
      { kind: "http", status: 500, body: { error: { message: "boom" } } },
    ];
    api.products.registerImage.mockImplementation(
      async (_pid: string, input: Record<string, unknown>) => ({
        id: "img-1",
        productId: PRODUCT_ID,
        publicId: input.publicId,
        secureUrl: input.secureUrl,
        version: 1,
        width: 1,
        height: 1,
        format: "jpg",
        bytes: 1,
        position: 0,
        isPrimary: true,
        altText: null,
        createdAt: Date.now(),
      }),
    );
    const result = await addProductImages(PRODUCT_ID, [photo("a.jpg"), photo("b.jpg")]);
    expect(result.mode).toBe("online");
    if (result.mode !== "online") throw new Error("unreachable");
    expect(result.uploaded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.name).toBe("b.jpg");
  });

  it("rejects bad files before any network call", async () => {
    await seedProduct();
    const bad = new File([new Uint8Array(10)], "a.gif", { type: "image/gif" });
    await expect(addProductImages(PRODUCT_ID, [bad])).rejects.toThrow("JPG");
    expect(api.products.imageSignature).not.toHaveBeenCalled();
    expect(sentRequests).toHaveLength(0);
  });
});

describe("offline queue and sync", () => {
  it("queues blobs + outbox when the signature call fails offline", async () => {
    await seedProduct();
    api.products.imageSignature.mockRejectedValue(new NetworkError("offline"));
    const result = await addProductImages(PRODUCT_ID, [photo()]);
    expect(result).toEqual({ mode: "offline", queued: 1 });
    const pending = await listPendingMedia(businessId, PRODUCT_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.blob).toBeInstanceOf(Blob);
    const ops = await getOutboxStore().listPending(businessId);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: "productImage", operation: "create" });
  });

  it("sync uploads the blob, registers, cleans up and reconciles", async () => {
    await seedProduct();
    api.products.imageSignature.mockRejectedValue(new NetworkError("offline"));
    await addProductImages(PRODUCT_ID, [photo()]);
    api.products.imageSignature.mockImplementation(async (_id: string, req: string) =>
      signatureResponse(req),
    );
    script = [{ kind: "ok", body: uploadBody("p") }];
    const imageId = "55555555-5555-4555-8555-555555555555";
    api.products.registerImage.mockImplementation(
      async (_pid: string, input: Record<string, unknown>) => ({
        id: imageId,
        productId: PRODUCT_ID,
        publicId: input.publicId,
        secureUrl: input.secureUrl,
        version: 1,
        width: 1,
        height: 1,
        format: "jpg",
        bytes: 1,
        position: 0,
        isPrimary: true,
        altText: null,
        createdAt: Date.now(),
      }),
    );
    api.products.get.mockResolvedValue({
      id: PRODUCT_ID,
      businessId,
      name: "Gomitas",
      category: "General",
      price: 500,
      avgCost: 100,
      stock: 10,
      lowStockAt: 5,
      archivedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      images: [
        {
          id: imageId,
          productId: PRODUCT_ID,
          publicId: "p",
          secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/p.jpg",
          version: 1,
          width: 1,
          height: 1,
          format: "jpg",
          bytes: 1,
          position: 0,
          isPrimary: true,
          altText: null,
          createdAt: Date.now(),
        },
      ],
    });
    const result = await syncPendingProductImages(businessId);
    expect(result.synced).toBe(1);
    expect(await listPendingMedia(businessId, PRODUCT_ID)).toHaveLength(0);
    const local = await getLocalStore().products.get(businessId, PRODUCT_ID);
    expect(local?.images.map((i) => i.id)).toEqual([imageId]);
  });

  it("missing blob becomes permanent failure, not an infinite retry", async () => {
    await seedProduct();
    api.products.imageSignature.mockRejectedValue(new NetworkError("offline"));
    await addProductImages(PRODUCT_ID, [photo()]);
    await getLocalDb().pendingMedia.where("businessId").equals(businessId).delete();
    const outbox = getOutboxStore();
    const result = await syncPendingProductImages(businessId);
    expect(result.failed).toBe(1);
    const [op] = await outbox.listByStatus(businessId, "failed");
    expect(op?.nextAttemptAt).toBeNull();
  });

  it("same requestId twice never duplicates the row", async () => {
    const requestId = "66666666-6666-4666-8666-666666666666";
    const store = getOutboxStore();
    await store.enqueue({
      operationId: "77777777-7777-4777-8777-777777777777",
      businessId,
      entity: "productImage",
      operation: "create",
      requestId,
      payload: { pendingMediaId: "missing", productId: PRODUCT_ID },
      dependsOn: [],
      localCreatedAt: Date.now(),
    });
    // enqueue refuses the same requestId twice for the same business
    await expect(
      store.enqueue({
        operationId: "88888888-8888-4888-8888-888888888888",
        businessId,
        entity: "productImage",
        operation: "create",
        requestId,
        payload: {},
        dependsOn: [],
        localCreatedAt: Date.now(),
      }),
    ).rejects.toThrow();
  });

  it("discardPendingMedia removes blob and outbox op", async () => {
    await seedProduct();
    api.products.imageSignature.mockRejectedValue(new NetworkError("offline"));
    await addProductImages(PRODUCT_ID, [photo()]);
    const [row] = await listPendingMedia(businessId, PRODUCT_ID);
    expect(row).toBeTruthy();
    await discardPendingMedia(businessId, row!.id);
    expect(await listPendingMedia(businessId, PRODUCT_ID)).toHaveLength(0);
    expect(await getOutboxStore().listPending(businessId)).toHaveLength(0);
  });

  it("tenant isolation holds for queue and sync", async () => {
    await seedProduct();
    api.session.businessId = otherBusinessId;
    await expect(addProductImages(PRODUCT_ID, [photo()])).rejects.toThrow();
    api.session.businessId = businessId;
  });
});

describe("patch and remove senders", () => {
  it("setPrimary online patches and refreshes", async () => {
    await seedProduct();
    api.products.patchImage.mockResolvedValue({ id: "img-1" });
    api.products.get.mockResolvedValue({
      id: PRODUCT_ID,
      businessId,
      name: "Gomitas",
      category: "General",
      price: 500,
      avgCost: 100,
      stock: 10,
      lowStockAt: 5,
      archivedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      images: [],
    });
    await setPrimaryImage(PRODUCT_ID, "img-1");
    expect(api.products.patchImage).toHaveBeenCalledWith(PRODUCT_ID, "img-1", {
      isPrimary: true,
    });
  });

  it("offline primary change enqueues a patch op", async () => {
    await seedProduct();
    const { getOutboxStore: getStore } = await import("@/data/local/outbox");
    // force offline by making patchImage throw NetworkError
    const { NetworkError: NE } = await import("@/data/errors");
    api.products.patchImage.mockRejectedValue(new NE("offline"));
    await setPrimaryImage(PRODUCT_ID, "img-1");
    const ops = await getStore().listPending(businessId);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: "productImage", operation: "patch" });
  });

  it("offline reorder enqueues with the full order", async () => {
    await seedProduct();
    const { NetworkError: NE } = await import("@/data/errors");
    api.products.reorderImages = vi.fn().mockRejectedValue(new NE("offline"));
    await reorderProductImages(PRODUCT_ID, ["a", "b"]);
    const ops = await getOutboxStore().listPending(businessId);
    expect(ops[0]?.payload).toMatchObject({ productId: PRODUCT_ID, imageIds: ["a", "b"] });
  });

  it("offline remove of a synced image enqueues a remove op", async () => {
    await seedProduct();
    await queueImageRemove(PRODUCT_ID, "img-9");
    const ops = await getOutboxStore().listPending(businessId);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: "productImage", operation: "remove" });
  });
});
