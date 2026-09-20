/** Human customer codes: DC-0001, unique per business. Never reuse a number. */

export function formatCustomerCode(n: number): string {
  return `DC-${String(n).padStart(4, "0")}`;
}

export function parseCustomerCodeNumber(code: string): number | null {
  const m = /^DC-(\d+)$/.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function nextCodeFromExisting(codes: string[]): string {
  let max = 0;
  for (const code of codes) {
    const n = parseCustomerCodeNumber(code);
    if (n != null && n > max) max = n;
  }
  return formatCustomerCode(max + 1);
}

export function normalizeCustomerCode(raw: string): string | null {
  const compact = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  const m = /^DC(\d+)$/.exec(compact);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  return formatCustomerCode(n);
}

export function normalizePersonName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}
