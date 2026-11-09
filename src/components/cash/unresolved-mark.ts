import { formatCop } from "@/domain/money";

/** C01.1 / C01-INV-05 — text of the «Cerrar igual» mark on a closed caja (null = no mark). */
export function unresolvedMarkText(count: number | null | undefined, amount: number | null | undefined): string | null {
  if (!count || count <= 0) return null;
  return `Cerrada con ${count} sin resolver (${formatCop(amount ?? 0)})`;
}
