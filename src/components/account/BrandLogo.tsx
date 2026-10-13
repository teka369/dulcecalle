import Image from "next/image";

export function BrandLogo({ size = 72 }: { size?: number }) {
  return (
    <Image
      src="/brand/dulcecalle-logo.png"
      alt="Dulce Calle"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="rounded-[var(--r-lg)] bg-surface object-contain"
      priority
    />
  );
}
