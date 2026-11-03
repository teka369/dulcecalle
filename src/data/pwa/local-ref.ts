/**
 * C01 — short local reference shown to the user for an op saved on this
 * device: `L-AAMMDD-XXXX` (creation day in device time + first 4 chars of the id).
 */
export function localRef(id: string, createdAt: number): string {
  const d = new Date(createdAt);
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  // UX-C01 A6: XXXX = first 4 characters of the local id, upper case.
  const tail = id.replace(/[^0-9a-zA-Z]/g, "").slice(0, 4).toUpperCase().padEnd(4, "0");
  return `L-${yy}${mm}${dd}-${tail}`;
}
