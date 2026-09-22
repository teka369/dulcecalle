/**
 * Cloudinary delivery URL helpers. The canonical secure_url is stored in
 * PostgreSQL; variants are derived locally by inserting ONE transformation
 * segment after /upload/. No secrets involved — delivery is public CDN.
 */

export type ImageVariant = "thumb" | "card" | "detail";

const VARIANTS: Record<ImageVariant, string> = {
  // 160px squaredens for lists and grids.
  thumb: "w_160,h_160,c_fill,q_auto,f_auto",
  // 640px wide card for detail headers.
  card: "w_640,c_limit,q_auto,f_auto",
  // 1200px bounded full view for gallery/lightbox.
  detail: "w_1200,c_limit,q_auto,f_auto",
};

/** Insert a transformation into a Cloudinary delivery URL. */
export function transformUrl(secureUrl: string, transform: string): string {
  const marker = "/image/upload/";
  const at = secureUrl.indexOf(marker);
  if (at < 0) return secureUrl;
  const head = secureUrl.slice(0, at + marker.length);
  const tail = secureUrl.slice(at + marker.length);
  // Avoid double-transforming an already-transformed URL.
  if (/^(w_|h_|c_|q_|f_|e_|a_)/.test(tail)) return secureUrl;
  return `${head}${transform}/${tail}`;
}

export function variantUrl(secureUrl: string, variant: ImageVariant): string {
  return transformUrl(secureUrl, VARIANTS[variant]);
}

/** Primary image first, then position order. Unknown shapes sink last. */
export function sortImages<T extends { isPrimary: boolean; position: number }>(
  images: readonly T[],
): T[] {
  return [...images].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.position - b.position;
  });
}

export function primaryImage<T extends { isPrimary: boolean; position: number }>(
  images: readonly T[],
): T | null {
  if (images.length === 0) return null;
  return sortImages(images)[0] ?? null;
}

/** secureUrl of the primary image, or null when the gallery is empty. */
export function primaryImageUrl(
  images: readonly { isPrimary: boolean; position: number; secureUrl: string }[] | null | undefined,
): string | null {
  if (!images || images.length === 0) return null;
  return primaryImage(images)?.secureUrl ?? null;
}
