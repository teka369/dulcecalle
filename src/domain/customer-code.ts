/** Human customer codes: DC-0001. Keep in sync with backend/src/shared/customer-code.ts */

export function formatCustomerCode(n: number): string {
  return `DC-${String(n).padStart(4, "0")}`;
}

export function parseCustomerCodeNumber(code: string): number | null {
  const m = /^DC-(\d+)$/.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
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

export function validateCustomerLoginInput(
  codeRaw: string,
  nameRaw: string,
): { code: string; name: string } | { error: string } {
  const code = normalizeCustomerCode(codeRaw);
  const name = nameRaw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!code || !name) {
    return { error: "Escribe el código y el nombre." };
  }
  return { code, name };
}
