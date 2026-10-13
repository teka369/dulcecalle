import Link from "next/link";

export function SectionHead({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      {link ? (
        <Link href={link.href} className="text-xs font-semibold text-ink underline underline-offset-2">
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}
