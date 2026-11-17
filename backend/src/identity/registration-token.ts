import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const REGISTER_ACCEPTED = {
  ok: true as const,
  status: "ACCEPTED" as const,
  message:
    "Si el correo es válido, te enviamos un enlace para confirmarlo. Revisa también el correo no deseado.",
};

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESEND_GAP_MS = 60 * 1000;
export const MAX_RESENDS = 5;
export const RESEND_LOCK_MS = 60 * 60 * 1000;

const NOT_REPLACEABLE = new Set(["APPROVED", "REJECTED", "PENDING_ADMIN_APPROVAL"]);

/**
 * A public form may replace name and password only when the previous request
 * is already closed. A live unverified request stays as the mailbox owner left it.
 */
export function canReplaceRegistrationCredentials(
  row: { status: string; userId?: string | null; expiresAt: Date },
  nowMs = Date.now(),
): boolean {
  if (row.userId) return false;
  if (NOT_REPLACEABLE.has(row.status)) return false;
  if (row.status === "EXPIRED") return true;
  if (row.status === "PENDING_EMAIL_VERIFICATION") return row.expiresAt.getTime() <= nowMs;
  return false;
}

export function newEmailToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function tokenHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Bots that fill the hidden field get a fake success and nothing is stored. */
export function isHoneypot(value: string | undefined | null): boolean {
  return Boolean(value && value.trim());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
