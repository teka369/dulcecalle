import { ApiError, NetworkError } from "../errors";
import type { RemoteProductImage } from "../http/mappers";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { getLocalStore } from "../local/store";
import { getOutboxStore, getOutboxSyncEngine } from "../local/outbox";
import type { LocalPendingMedia } from "../local/types";
import { newEntityId, newRequestId } from "@/domain/requestId";
import {
  MAX_IMAGES_PER_PRODUCT,
  MAX_PENDING_BYTES,
  imageErrorMessage,
  validateImageFile,
  type ImageValidationError,
} from "../media/validate";

export type UploadProgress = { loaded: number; total: number };

export type CloudinaryUploadResult = {
  publicId: string;
  secureUrl: string;
  version: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
  assetId: string | null;
};

function businessId(): string {
  const id = getPwaAuthSession().businessId;
  if (!id) throw new Error("Selecciona un negocio.");
  return id;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse + validate a Cloudinary upload response. Never trust it blindly. */
export function parseUploadResponse(raw: unknown): CloudinaryUploadResult {
  const row = asRecord(raw);
  const publicId = row ? String(row.public_id ?? "") : "";
  const secureUrl = row ? String(row.secure_url ?? "") : "";
  const resourceType = row ? String(row.resource_type ?? "") : "";
  if (!publicId || !secureUrl || resourceType !== "image") {
    throw new ApiError("VALIDATION", "Respuesta de subida inválida.", 400);
  }
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  return {
    publicId,
    secureUrl,
    version: num(row?.version),
    width: num(row?.width),
    height: num(row?.height),
    format: row?.format == null ? null : String(row.format).slice(0, 16),
    bytes: num(row?.bytes),
    assetId: row?.asset_id == null ? null : String(row.asset_id).slice(0, 128),
  };
}

/**
 * Browser → Cloudinary direct upload with progress. No secrets involved:
 * only the server-minted signature fields travel with the file.
 */
export function uploadToCloudinary(
  uploadUrl: string,
  fields: Record<string, string | number>,
  file: Blob,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.upload.onprogress = (event) => {
      onProgress?.({ loaded: event.loaded, total: event.total });
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new ApiError(
            "VALIDATION",
            "Esta imagen no se pudo subir. Puedes intentarlo de nuevo.",
            xhr.status,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as unknown);
      } catch {
        reject(new ApiError("VALIDATION", "Respuesta de subida inválida.", 400));
      }
    };
    xhr.onerror = () => reject(new NetworkError("Sin conexión."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.ontimeout = () => reject(new NetworkError("Sin conexión."));
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, String(value));
    }
    xhr.send(form);
  });
}

export type AddImagesResult =
  | { mode: "online"; uploaded: RemoteProductImage[]; failed: Array<{ name: string; error: string }> }
  | { mode: "offline"; queued: number };

async function refreshLocalImages(businessId: string, productId: string): Promise<void> {
  const remote = await getPwaApi().products.get(productId);
  const local = await getLocalStore().products.get(businessId, productId);
  if (!local) return;
  await getLocalStore().products.put({ ...local, images: remote.images, updatedAt: Date.now() });
}

async function pendingBytes(businessId: string): Promise<number> {
  const rows = await getLocalDb().pendingMedia.where("businessId").equals(businessId).toArray();
  return rows.reduce((sum, row) => sum + row.size, 0);
}

async function remoteImageCount(api: ReturnType<typeof getPwaApi>, productId: string): Promise<number> {
  try {
    return (await api.products.listImages(productId)).length;
  } catch {
    return 0;
  }
}

/**
 * Add photos to a product. Online: signature → Cloudinary → register, per
 * file, with per-file results (4/5 style partial success is explicit).
 * Offline (or transport failure): blobs go to pendingMedia + one outbox op
 * each, uploaded by the sync engine later. Never invents server state.
 */
export async function addProductImages(
  productId: string,
  files: File[],
  opts?: {
    altText?: string;
    onFileProgress?: (fileName: string, p: UploadProgress) => void;
  },
): Promise<AddImagesResult> {
  const business = businessId();
  const api = getPwaApi();
  const db = getLocalDb();

  // Defense in depth: the backend re-validates ownership, but never queue
  // blobs against a product this business cannot even see locally.
  const localProduct = await getLocalStore().products.get(business, productId);
  if (!localProduct) {
    throw new Error("El producto no está disponible sin conexión.");
  }

  const existing = await db.pendingMedia.where("[businessId+productId]").equals([business, productId]).toArray();
  const remoteCount = await remoteImageCount(api, productId);
  if (existing.length + remoteCount + files.length > MAX_IMAGES_PER_PRODUCT) {
    throw new Error(`Un producto acepta máximo ${MAX_IMAGES_PER_PRODUCT} fotos.`);
  }

  const validated: Array<{ file: File; name: string }> = [];
  for (const file of files) {
    const check = validateImageFile(file);
    if (!check.ok) {
      const code: ImageValidationError = check.error;
      throw new Error(imageErrorMessage(code));
    }
    validated.push({ file, name: file.name });
  }

  const uploaded: RemoteProductImage[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  let queued = 0;

  for (const { file, name } of validated) {
    const requestId = newRequestId("product-image");
    try {
      const sig = await api.products.imageSignature(productId, requestId);
      const raw = await uploadToCloudinary(
        sig.uploadUrl,
        {
          api_key: sig.apiKey,
          timestamp: sig.timestamp,
          public_id: sig.publicId,
          signature: sig.signature,
        },
        file,
        (p) => opts?.onFileProgress?.(name, p),
      );
      const parsed = parseUploadResponse(raw);
      const image = await api.products.registerImage(
        productId,
        {
          publicId: parsed.publicId,
          secureUrl: parsed.secureUrl,
          resourceType: "image",
          version: parsed.version ?? undefined,
          width: parsed.width ?? undefined,
          height: parsed.height ?? undefined,
          format: parsed.format ?? undefined,
          bytes: parsed.bytes ?? undefined,
          altText: opts?.altText,
        },
        requestId,
      );
      uploaded.push(image);
    } catch (error) {
      if (error instanceof NetworkError || isOfflineError(error)) {
        await queuePendingMedia(business, productId, file, name, requestId, opts?.altText);
        queued += 1;
        continue;
      }
      failed.push({ name, error: error instanceof Error ? error.message : "No se pudo subir." });
    }
  }

  if (uploaded.length > 0) {
    try {
      await refreshLocalImages(business, productId);
    } catch {
      /* cache refresh is best-effort; outbox/sync stays authoritative */
    }
  }
  if (queued > 0) return { mode: "offline", queued };
  return { mode: "online", uploaded, failed };
}

function isOfflineError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function queuePendingMedia(
  business: string,
  productId: string,
  file: Blob,
  fileName: string,
  requestId: string,
  altText?: string,
): Promise<void> {
  const db = getLocalDb();
  const outbox = getOutboxStore();
  if ((await pendingBytes(business)) + file.size > MAX_PENDING_BYTES) {
    throw new Error(imageErrorMessage("quota"));
  }
  const now = Date.now();
  const row: LocalPendingMedia = {
    id: newEntityId(),
    businessId: business,
    productId,
    requestId,
    fileName,
    mime: (file as File).type || "image/jpeg",
    size: file.size,
    blob: file,
    position: null,
    isPrimary: false,
    altText: altText?.trim() || null,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
  };
  await db.transaction("rw", [db.pendingMedia, db.outbox], async () => {
    await db.pendingMedia.put(row);
    await outbox.enqueue({
      operationId: row.id,
      businessId: business,
      entity: "productImage",
      operation: "create",
      requestId,
      payload: { pendingMediaId: row.id, productId, altText: row.altText },
      dependsOn: [],
      localCreatedAt: now,
    });
  });
}

/** Discard a never-synced local upload (pending blob + its outbox op). */
export async function discardPendingMedia(businessId: string, pendingMediaId: string): Promise<void> {
  const db = getLocalDb();
  const outbox = getOutboxStore();
  const row = await db.pendingMedia.get(pendingMediaId);
  if (!row || row.businessId !== businessId) return;
  const op = await outbox.getByRequestId(businessId, row.requestId).catch(() => undefined);
  await db.transaction("rw", [db.pendingMedia, db.outbox], async () => {
    await db.pendingMedia.delete(pendingMediaId);
    if (op && (op.status === "pending" || op.status === "failed")) {
      await outbox.discard(businessId, op.operationId);
    }
  });
}

/**
 * Enqueue a server-image delete for later (offline remove). The local row
 * keeps rendering until the sync succeeds; Sync Center shows the op.
 */
export async function queueImageRemove(
  productId: string,
  imageId: string,
  requestId = newRequestId("product-image-remove"),
): Promise<void> {
  const business = businessId();
  await getOutboxStore().enqueue({
    operationId: newEntityId(),
    businessId: business,
    entity: "productImage",
    operation: "remove",
    requestId,
    payload: { productId, imageId },
    dependsOn: [],
    localCreatedAt: Date.now(),
  });
}

export async function listPendingMedia(
  businessId: string,
  productId: string,
): Promise<LocalPendingMedia[]> {
  return getLocalDb()
    .pendingMedia.where("[businessId+productId]")
    .equals([businessId, productId])
    .sortBy("createdAt");
}

async function senderRefresh(business: string, productId: string): Promise<void> {
  try {
    await refreshLocalImages(business, productId);
  } catch {
    /* best-effort */
  }
}

/** Sync engine sender for productImage ops (create/patch/remove). */
export async function syncPendingProductImages(business: string) {
  const api = getPwaApi();
  const engine = getOutboxSyncEngine();
  return engine.flush(
    business,
    async (item) => {
      if (item.entity !== "productImage") {
        throw new Error("Operación de outbox no compatible con imágenes.");
      }
      if (item.operation === "create") {
        const payload = item.payload as {
          pendingMediaId: string;
          productId: string;
          altText?: string | null;
        };
        const pending = await getLocalDb().pendingMedia.get(payload.pendingMediaId);
        if (!pending || pending.businessId !== business) {
          throw new ApiError(
            "VALIDATION",
            "La foto ya no está en este dispositivo. Descarta la operación.",
            400,
          );
        }
        const sig = await api.products.imageSignature(payload.productId, item.requestId);
        const raw = await uploadToCloudinary(sig.uploadUrl, {
          api_key: sig.apiKey,
          timestamp: sig.timestamp,
          public_id: sig.publicId,
          signature: sig.signature,
        }, pending.blob);
        const parsed = parseUploadResponse(raw);
        const image = await api.products.registerImage(
          payload.productId,
          {
            publicId: parsed.publicId,
            secureUrl: parsed.secureUrl,
            resourceType: "image",
            version: parsed.version ?? undefined,
            width: parsed.width ?? undefined,
            height: parsed.height ?? undefined,
            format: parsed.format ?? undefined,
            bytes: parsed.bytes ?? undefined,
            altText: pending.altText ?? undefined,
          },
          item.requestId,
        );
        await getLocalDb().pendingMedia.delete(pending.id);
        await senderRefresh(business, payload.productId);
        return { remoteId: image.id };
      }
      if (item.operation === "patch") {
        const payload = item.payload as {
          productId: string;
          imageId?: string;
          imageIds?: string[];
          changes?: { isPrimary?: boolean; altText?: string };
        };
        if (payload.imageIds) {
          await api.products.reorderImages(payload.productId, payload.imageIds);
          await senderRefresh(business, payload.productId);
          return { remoteId: payload.imageIds[0] ?? payload.productId };
        }
        if (!payload.imageId) {
          throw new ApiError("VALIDATION", "Operación de imagen incompleta.", 400);
        }
        const remote = await api.products.patchImage(
          payload.productId,
          payload.imageId,
          payload.changes ?? {},
        );
        await senderRefresh(business, payload.productId);
        return { remoteId: remote.id };
      }
      if (item.operation === "remove") {
        const payload = item.payload as { productId: string; imageId: string };
        const remote = await api.products.removeImage(payload.productId, payload.imageId);
        await senderRefresh(business, payload.productId);
        return { remoteId: remote.id };
      }
      throw new Error("Operación de outbox no compatible con imágenes.");
    },
    (item) => item.entity === "productImage",
  );
}

export async function setPrimaryImage(
  productId: string,
  imageId: string,
  requestId = newRequestId("product-image-primary"),
): Promise<void> {
  const business = businessId();
  try {
    await getPwaApi().products.patchImage(productId, imageId, { isPrimary: true });
    await senderRefresh(business, productId);
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: business,
      entity: "productImage",
      operation: "patch",
      requestId,
      payload: { productId, imageId, changes: { isPrimary: true } },
      dependsOn: [],
      localCreatedAt: Date.now(),
    });
  }
}

export async function reorderProductImages(
  productId: string,
  imageIds: string[],
  requestId = newRequestId("product-image-order"),
): Promise<void> {
  const business = businessId();
  try {
    await getPwaApi().products.reorderImages(productId, imageIds);
    await senderRefresh(business, productId);
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: business,
      entity: "productImage",
      operation: "patch",
      requestId,
      payload: { productId, imageIds },
      dependsOn: [],
      localCreatedAt: Date.now(),
    });
  }
}

