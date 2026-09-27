import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "icon";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "h-11 min-h-11 bg-cta px-4 text-sm font-semibold text-cta-fg hover:opacity-[0.92]",
  secondary:
    "h-11 min-h-11 border border-border bg-surface px-4 text-sm font-semibold text-ink hover:opacity-[0.92]",
  ghost:
    "h-11 min-h-11 bg-transparent px-4 text-sm font-semibold text-ink hover:text-cta hover:opacity-[0.92]",
  danger:
    "h-11 min-h-11 bg-danger px-4 text-sm font-semibold text-white hover:opacity-[0.92]",
  icon:
    "h-11 w-11 min-h-11 min-w-11 items-center justify-center p-0 hover:opacity-[0.92]",
};

export function Button({
  variant = "primary",
  className = "",
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        "inline-flex min-w-11 items-center justify-center rounded-[var(--r-md)] transition-opacity",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANT_CLASS[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
