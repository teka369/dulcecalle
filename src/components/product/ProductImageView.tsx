"use client";

import { useState } from "react";
import { variantUrl, type ImageVariant } from "@/data/media/urls";

type Props = {
  secureUrl: string | null;
  alt: string;
  variant?: ImageVariant;
  className?: string;
  eager?: boolean;
};

/**
 * Single product photo. Never renders a broken icon or a raw URL:
 * missing sources show the Dulce Calle placeholder, load errors swap to
 * it as well.
 */
export function ProductImageView({
  secureUrl,
  alt,
  variant = "card",
  className = "",
  eager = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  if (!secureUrl || failed) {
    return (
      <div
        role="img"
        aria-label={alt || "Sin foto"}
        className={`flex items-center justify-center overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.04] ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/DulceCalle.png"
          alt=""
          aria-hidden
          className="h-2/3 w-2/3 object-contain opacity-60"
          loading="lazy"
        />
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.04] ${className}`}>
      {loading && (
        <div className="absolute inset-0 animate-pulse bg-ink/[0.06]" aria-hidden />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={variantUrl(secureUrl, variant)}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        onLoad={() => setLoading(false)}
        onError={() => {
          setFailed(true);
          setLoading(false);
        }}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
