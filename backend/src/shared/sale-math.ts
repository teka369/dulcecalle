import { asCop, subCop } from "./money";
import { AppError, ERROR_CODES, MESSAGES } from "./errors";

export type PaymentKind = "paid" | "partial" | "credit";

export function assertPaymentMath(
  kind: PaymentKind,
  saleTotal: bigint,
  amountReceived: bigint,
): { credit: bigint } {
  const total = asCop(saleTotal);
  const received = asCop(amountReceived);
  if (received < 0n || received > total) {
    throw new AppError(ERROR_CODES.VALIDATION, "amountReceived must be between 0 and saleTotal");
  }
  if (kind === "paid") {
    if (received !== total) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        "paid sale requires amountReceived === saleTotal",
      );
    }
    return { credit: 0n };
  }
  if (kind === "credit") {
    if (received !== 0n) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        "credit (fiada) sale requires amountReceived === 0",
      );
    }
    return { credit: total };
  }
  if (received <= 0n || received >= total) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      "partial sale requires 0 < amountReceived < saleTotal",
    );
  }
  return { credit: subCop(total, received) };
}

export function resolveUnitPrice(
  catalogPrice: bigint,
  override: number | undefined,
): bigint {
  if (override === undefined) return asCop(catalogPrice);
  if (!Number.isInteger(override) || override < 0) {
    throw new AppError(ERROR_CODES.VALIDATION, MESSAGES.badPrice);
  }
  return asCop(override);
}
