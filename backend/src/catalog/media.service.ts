import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import type { BusinessContext } from "../identity/auth.types";
import type {
  PatchProductImageDto,
  RegisterProductImageDto,
} from "./media.dto";

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export type UploadSignature = {
  cloudName: string;
  apiKey: string;
  uploadUrl: string;
  timestamp: number;
  signature: string;
  publicId: string;
  requestId: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCloudinaryConfig(
  env: NodeJS.ProcessEnv = process.env,
): CloudinaryConfig | null {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim() ?? "";
  const apiKey = env.CLOUDINARY_API_KEY?.trim() ?? "";
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim() ?? "";
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

/**
 * SHA-1 signature per Cloudinary docs: sorted `name=value` pairs joined
 * with `&`, API secret appended, hex digest. `file`, `cloud_name`,
 * `resource_type` and `api_key` are never signed.
 */
export function signUploadParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const serialized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(serialized + apiSecret).digest("hex");
}

export function imagePublicId(
  businessId: string,
  productId: string,
  requestId: string,
): string {
  return `dulcecalle/${businessId}/products/${productId}/${requestId}`;
}

export function parseImagePublicId(publicId: string): {
  businessId: string;
  productId: string;
  requestId: string;
} | null {
  const match = /^dulcecalle\/([^/]+)\/products\/([^/]+)\/([^/]+)$/.exec(
    publicId.trim(),
  );
  if (!match) return null;
  const [, businessId, productId, requestId] = match;
  if (!UUID_RE.test(businessId) || !UUID_RE.test(productId) || !UUID_RE.test(requestId)) {
    return null;
  }
  return { businessId, productId, requestId };
}

/** Delivery URL builder: inserts one transformation set after /upload/. */
export function deliveryUrl(
  cloudName: string,
  publicId: string,
  format: string | null,
  transform?: string,
): string {
  const suffix = format ? `.${format}` : "";
  const middle = transform ? `${transform}/` : "";
  return `https://res.cloudinary.com/${cloudName}/image/upload/${middle}${publicId}${suffix}`;
}

export function imageJson(img: {
  id: string;
  productId: string;
  publicId: string;
  secureUrl: string;
  version: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
  position: number;
  isPrimary: boolean;
  altText: string | null;
  createdAt: Date;
}) {
  return {
    id: img.id,
    productId: img.productId,
    publicId: img.publicId,
    secureUrl: img.secureUrl,
    version: img.version,
    width: img.width,
    height: img.height,
    format: img.format,
    bytes: img.bytes,
    position: img.position,
    isPrimary: img.isPrimary,
    altText: img.altText,
    createdAt: img.createdAt,
  };
}

type FetchImpl = typeof fetch;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  private config(): CloudinaryConfig {
    const config = readCloudinaryConfig();
    if (!config) {
      throw new AppError(
        ERROR_CODES.INTERNAL,
        "Imágenes no configuradas en el servidor.",
      );
    }
    return config;
  }

  private async requireProduct(ctx: BusinessContext, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId: ctx.businessId },
    });
    if (!product) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    return product;
  }

  /**
   * Signed upload grant: the browser uploads straight to Cloudinary, but
   * the signed fields (exact public_id + timestamp) are minted here after
   * ownership validation. Secret never leaves the server.
   */
  async signUpload(
    ctx: BusinessContext,
    productId: string,
    requestId: string,
  ): Promise<UploadSignature> {
    const config = this.config();
    await this.requireProduct(ctx, productId);
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = imagePublicId(ctx.businessId, productId, requestId);
    const signature = signUploadParams(
      { public_id: publicId, timestamp },
      config.apiSecret,
    );
    return {
      cloudName: config.cloudName,
      apiKey: config.apiKey,
      uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
      timestamp,
      signature,
      publicId,
      requestId,
    };
  }

  /**
   * Persist upload metadata after a successful browser upload. Idempotent
   * on (businessId, requestId): retrying with the same key returns the
   * same row instead of duplicating, and the same public_id makes the
   * Cloudinary side converge too.
   */
  async registerImage(
    ctx: BusinessContext,
    productId: string,
    dto: RegisterProductImageDto,
  ) {
    const config = this.config();
    await this.requireProduct(ctx, productId);
    if (dto.resourceType !== undefined && dto.resourceType !== "image") {
      throw new AppError(ERROR_CODES.VALIDATION, "Solo se permiten imágenes.");
    }
    const parsed = parseImagePublicId(dto.publicId);
    if (
      !parsed ||
      parsed.businessId !== ctx.businessId ||
      parsed.productId !== productId ||
      parsed.requestId !== dto.requestId
    ) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        "Identificador de imagen inválido.",
      );
    }
    const expectedPrefix = `https://res.cloudinary.com/${config.cloudName}/image/upload/`;
    if (
      !dto.secureUrl.startsWith(expectedPrefix) ||
      !dto.secureUrl.includes(dto.publicId)
    ) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        "URL de imagen inválida.",
      );
    }

    const existing = await this.prisma.productImage.findUnique({
      where: {
        businessId_requestId: { businessId: ctx.businessId, requestId: dto.requestId },
      },
    });
    if (existing) return imageJson(existing);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const count = await tx.productImage.count({
          where: { businessId: ctx.businessId, productId },
        });
        const makePrimary = count === 0 || dto.isPrimary === true;
        if (dto.isPrimary === true) {
          await tx.productImage.updateMany({
            where: { businessId: ctx.businessId, productId },
            data: { isPrimary: false },
          });
        }
        return tx.productImage.create({
          data: {
            id: randomUUID(),
            businessId: ctx.businessId,
            productId,
            publicId: dto.publicId,
            secureUrl: dto.secureUrl,
            version: dto.version ?? null,
            width: dto.width ?? null,
            height: dto.height ?? null,
            format: dto.format ?? null,
            bytes: dto.bytes ?? null,
            position: count,
            isPrimary: makePrimary,
            altText: dto.altText?.trim() || null,
            requestId: dto.requestId,
          },
        });
      });
      return imageJson(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.productImage.findUnique({
          where: {
            businessId_requestId: { businessId: ctx.businessId, requestId: dto.requestId },
          },
        });
        if (again) return imageJson(again);
      }
      throw e;
    }
  }

  async listImages(ctx: BusinessContext, productId: string) {
    await this.requireProduct(ctx, productId);
    const rows = await this.prisma.productImage.findMany({
      where: { businessId: ctx.businessId, productId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(imageJson);
  }

  async patchImage(
    ctx: BusinessContext,
    productId: string,
    imageId: string,
    dto: PatchProductImageDto,
  ) {
    await this.requireProduct(ctx, productId);
    const existing = await this.prisma.productImage.findFirst({
      where: { id: imageId, businessId: ctx.businessId, productId },
    });
    if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await tx.productImage.updateMany({
          where: { businessId: ctx.businessId, productId },
          data: { isPrimary: false },
        });
      }
      return tx.productImage.update({
        where: { id: imageId },
        data: {
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.altText !== undefined
            ? { altText: dto.altText?.trim() || null }
            : {}),
        },
      });
    });
    return imageJson(updated);
  }

  /** Full reorder: array of image ids in desired order, applied atomically. */
  async reorderImages(
    ctx: BusinessContext,
    productId: string,
    imageIds: string[],
  ) {
    await this.requireProduct(ctx, productId);
    const rows = await this.prisma.productImage.findMany({
      where: { businessId: ctx.businessId, productId },
    });
    const known = new Set(rows.map((r) => r.id));
    if (imageIds.length !== rows.length || !imageIds.every((id) => known.has(id))) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        "El orden debe incluir todas las imágenes una vez.",
      );
    }
    await this.prisma.$transaction(
      imageIds.map((id, position) =>
        this.prisma.productImage.update({ where: { id }, data: { position } }),
      ),
    );
    const ordered = await this.prisma.productImage.findMany({
      where: { businessId: ctx.businessId, productId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return ordered.map(imageJson);
  }

  /**
   * Delete: destroy the Cloudinary asset first (server-side, secret stays
   * here), then remove the row. A Cloudinary 404 still deletes the row so
   * retries converge; other Cloudinary failures abort with 502 and the row
   * is kept for retry. If no image remains primary, the lowest position
   * is promoted.
   */
  async removeImage(ctx: BusinessContext, productId: string, imageId: string) {
    const config = this.config();
    await this.requireProduct(ctx, productId);
    const existing = await this.prisma.productImage.findFirst({
      where: { id: imageId, businessId: ctx.businessId, productId },
    });
    if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, MESSAGES.notFound);

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signUploadParams(
      { public_id: existing.publicId, timestamp },
      config.apiSecret,
    );
    const body = new URLSearchParams({
      public_id: existing.publicId,
      api_key: config.apiKey,
      timestamp: String(timestamp),
      signature,
      invalidate: "true",
    });
    let destroyRes: Response;
    try {
      destroyRes = await this.fetchImpl(
        `https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`,
        { method: "POST", body },
      );
    } catch {
      throw new AppError(ERROR_CODES.INTERNAL, "No se pudo eliminar la imagen.");
    }
    // Cloudinary answers 200 with a JSON body even when the asset is
    // already gone ({ result: "not found" }). Only that case converges
    // with the row delete; any other non-ok result keeps the row so a
    // retry can reconcile instead of silently losing the association.
    if (destroyRes.status === 404) {
      // No-op: fall through to the row delete below.
    } else if (destroyRes.status !== 200) {
      throw new AppError(ERROR_CODES.INTERNAL, "No se pudo eliminar la imagen.");
    } else {
      let destroyBody: unknown = null;
      try {
        destroyBody = await destroyRes.json();
      } catch {
        throw new AppError(ERROR_CODES.INTERNAL, "No se pudo eliminar la imagen.");
      }
      const result =
        typeof destroyBody === "object" && destroyBody !== null
          ? String((destroyBody as Record<string, unknown>).result ?? "")
          : "";
      if (result !== "ok" && result !== "not found") {
        throw new AppError(ERROR_CODES.INTERNAL, "No se pudo eliminar la imagen.");
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      if (existing.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { businessId: ctx.businessId, productId },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        });
        if (next) {
          await tx.productImage.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
        }
      }
    });
    return { deleted: true as const, id: imageId };
  }
}
