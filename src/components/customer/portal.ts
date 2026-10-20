/** Pure view helpers for the customer portal (/cliente/*). Read-only; no writes exist here. */
import type { CustomerLedger } from "@/data/http/customer-api";
import type { CustomerStatementRow } from "@/data/pwa/customer-portal";
import { ApiError } from "@/data/errors";

export const PORTAL_OFFLINE_MESSAGE = "Sin conexión.";
export const PORTAL_LOAD_FAILED_MESSAGE = "No se pudo cargar";

/**
 * "Sin conexión." only when the device really is offline. With network up,
 * a failing API (transport error, timeout or 5xx) reads "No se pudo cargar".
 */
export function portalErrorMessage(error: unknown, online: boolean): string {
  if (!online) return PORTAL_OFFLINE_MESSAGE;
  // A contractual 4xx keeps its message (e.g. session expired); transport
  // failures, timeouts and 5xx are "the server failed", not "no network".
  if (error instanceof ApiError && error.status < 500 && error.message) return error.message;
  return PORTAL_LOAD_FAILED_MESSAGE;
}

export function browserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * Defence in depth: only render a ledger that belongs to the signed-in customer.
 * The server scopes by business + customer and the cache is keyed by customerId;
 * this guard makes a mismatched snapshot (other customer/business) render nothing.
 */
export function ownLedger(ledger: CustomerLedger | null | undefined, sessionCustomerId: string | null | undefined): CustomerLedger | null {
  if (!ledger || !sessionCustomerId) return null;
  return ledger.customer.id === sessionCustomerId ? ledger : null;
}

/** DEBES hero: the balance is the server debt, never received/abonado totals. */
export function debtHero(ledger: CustomerLedger) {
  const debt = ledger.customer.debt;
  return debt > 0
    ? { owes: true as const, label: "Debes", value: debt, caption: "Esto es lo que debes en este momento." }
    : { owes: false as const, label: "Al día", value: 0, caption: "Estás al día. No debes nada." };
}

/** Only fiado/deuda anterior raise the debt; abonos and debt-reducing returns lower it. */
export function statementSign(row: Pick<CustomerStatementRow, "kind">) {
  if (row.kind === "pago" || row.kind === "devolucion") {
    return { sign: "−" as const, word: "Baja tu deuda", tone: "ok" as const };
  }
  if (row.kind === "compra") return { sign: "" as const, word: "Pagada", tone: "neutral" as const };
  if (row.kind === "reembolso") return { sign: "" as const, word: "Te devolvimos", tone: "neutral" as const };
  return { sign: "+" as const, word: "Sube tu deuda", tone: "danger" as const };
}

export function purchaseLabel(credit: number, paymentKind: string): string {
  if (credit > 0) return paymentKind === "partial" ? "Venta parcial" : "A crédito";
  return "Compra";
}

export function purchaseTone(credit: number, paymentKind: string): "ok" | "warning" | "info" {
  if (credit <= 0) return "ok";
  return paymentKind === "partial" ? "warning" : "info";
}

export function epoch(value: string | number): number {
  if (typeof value === "number") return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

export function newestFirst<T extends { createdAt: string | number }>(list: ReadonlyArray<T>): T[] {
  return [...list].sort((a, b) => epoch(b.createdAt) - epoch(a.createdAt));
}

export const PORTAL_TABS = [
  { href: "/cliente", label: "Inicio" },
  { href: "/cliente/cuenta", label: "Cuenta" },
  { href: "/cliente/compras", label: "Compras" },
  { href: "/cliente/pagos", label: "Pagos" },
  { href: "/cliente/productos", label: "Productos" },
  { href: "/cliente/perfil", label: "Perfil" },
] as const;

export function activePortalTab(pathname: string): string | null {
  if (pathname === "/cliente") return "/cliente";
  const hit = PORTAL_TABS.find((t) => t.href !== "/cliente" && (pathname === t.href || pathname.startsWith(`${t.href}/`)));
  return hit?.href ?? null;
}
