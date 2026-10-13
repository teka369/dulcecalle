import { ABOVE_ACTION_BAR } from "@/components/ui/ActionBar";

/** Status toast that clears the ActionBar (--actionbar-h). */
export function ActionToast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      role="status"
      className={`fixed ${ABOVE_ACTION_BAR} left-1/2 z-50 max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-center text-sm text-bg`}
    >
      {text}
    </div>
  );
}
