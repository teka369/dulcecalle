import type { ReactNode } from "react";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Chevron } from "./icons";

export type RowProps = {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
};

/** List row (min 56px). Whole row is one link when href is set. */
export function Row({ href, leading, title, meta, trailing, chevron = href != null }: RowProps) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug text-ink">{title}</span>
        {meta != null ? <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{meta}</span> : null}
      </span>
      {trailing != null ? <span className="flex shrink-0 flex-col items-end gap-1">{trailing}</span> : null}
      {chevron ? <Chevron /> : null}
    </>
  );
  const cls = "flex min-h-14 items-center gap-3 px-3 py-2.5";
  return (
    <li>
      {href ? (
        <OfflineLink href={href} className={cls}>
          {body}
        </OfflineLink>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
