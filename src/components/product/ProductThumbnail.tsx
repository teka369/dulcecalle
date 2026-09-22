"use client";

import { ProductImageView } from "./ProductImageView";

const SIZES = {
  /** Sale lines, surtidas, compact rows. */
  xs: "h-8 w-8",
  /** Selectors, portal lines, return rows. */
  sm: "h-10 w-10",
  /** Cards, detail headers, surtir. */
  md: "h-14 w-14",
} as const;

export type ThumbnailSize = keyof typeof SIZES;

type Props = {
  /** Primary secureUrl, or null to render the official placeholder. */
  secureUrl: string | null | undefined;
  /** Product name. Ignored visually when decorative. */
  alt: string;
  size?: ThumbnailSize;
  /**
   * True when the product name already appears as adjacent text: the image
   * is hidden from assistive tech to avoid repeating the name.
   */
  decorative?: boolean;
  className?: string;
};

/**
 * The single small-product-image strategy for all of Dulce Calle.
 * Fixed size (no layout shift), thumb variant, lazy, official fallback.
 * Financial logic never belongs here: pass the resolved image in.
 */
export function ProductThumbnail({
  secureUrl,
  alt,
  size = "sm",
  decorative = true,
  className = "",
}: Props) {
  return (
    <ProductImageView
      secureUrl={secureUrl ?? null}
      alt={decorative ? "" : alt}
      variant="thumb"
      className={`${SIZES[size]} shrink-0 ${className}`}
    />
  );
}
