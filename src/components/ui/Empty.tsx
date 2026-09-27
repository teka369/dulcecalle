import type { ReactNode } from "react";

export type EmptyProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

function DefaultIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="40"
      height="40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink-muted"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 13h3" />
    </svg>
  );
}

export function Empty({
  title,
  description,
  action,
  icon,
  className = "",
}: EmptyProps) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-3 px-4 py-10 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
    >
      <div className="flex min-h-11 min-w-11 items-center justify-center">
        {icon ?? <DefaultIcon />}
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description ? (
        <p className="max-w-sm text-sm leading-snug text-ink-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
