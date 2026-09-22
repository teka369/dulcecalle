/**
 * Client-side file validation for product photos. Mirrors the server's
 * hard limits; the backend re-validates everything on register.
 */

export const MAX_IMAGES_PER_PRODUCT = 8;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PENDING_BYTES = 32 * 1024 * 1024;
export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ImageValidationError =
  | "type"
  | "size"
  | "count"
  | "quota"
  | "empty";

const MESSAGES: Record<ImageValidationError, string> = {
  type: "Solo se permiten fotos JPG, PNG o WebP.",
  size: "Cada foto debe pesar 5 MB o menos.",
  count: "Un producto acepta máximo 8 fotos.",
  quota: "Sin espacio para más fotos pendientes. Sincroniza primero.",
  empty: "El archivo está vacío o dañado.",
};

export function imageErrorMessage(code: ImageValidationError): string {
  return MESSAGES[code];
}

export type ValidatedImageFile = {
  file: File;
  ext: "jpg" | "png" | "webp";
};

function extForMime(mime: string): ValidatedImageFile["ext"] | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

function extOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Validates MIME + extension agreement (cheap spoof check), size and
 * non-emptiness. Returns the normalized extension or the error code.
 */
export function validateImageFile(
  file: Pick<File, "name" | "size" | "type">,
): { ok: true; ext: ValidatedImageFile["ext"] } | { ok: false; error: ImageValidationError } {
  if (!file.size || !Number.isFinite(file.size)) {
    return { ok: false, error: "empty" };
  }
  const ext = extForMime(file.type);
  if (!ext) return { ok: false, error: "type" };
  const nameExt = extOfName(file.name);
  const agrees =
    nameExt === "" ||
    nameExt === ext ||
    (ext === "jpg" && nameExt === "jpeg");
  if (!agrees) return { ok: false, error: "type" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "size" };
  return { ok: true, ext };
}
