import { Badge } from "./Badge";
import { GlyphIcon } from "./icons";

/** Replaces «⏳ Pendiente»: clock SVG + same word, warning tone. */
export function PendingBadge({ label = "Pendiente" }: { label?: string }) {
  return (
    <Badge tone="warning" className="gap-1">
      <span className="[&_svg]:size-3.5" aria-hidden>
        <GlyphIcon name="clock" />
      </span>
      {label}
    </Badge>
  );
}
