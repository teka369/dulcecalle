import { ParseUUIDPipe } from "@nestjs/common";
import { AppError, ERROR_CODES } from "../errors";

/**
 * loop/v1 M3: every `:id` route param is a UUID (`@db.Uuid` columns). A
 * malformed one answers 400 VALIDATION before reaching Prisma (no 500).
 */
export const UuidParam = new ParseUUIDPipe({
  exceptionFactory: () => new AppError(ERROR_CODES.VALIDATION, "Identificador inválido."),
});

/** Optional UUID query param: undefined passes; anything else must be a UUID. */
export function optionalUuidQuery(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(ERROR_CODES.VALIDATION, `Parámetro ${name} inválido.`);
  }
  return value;
}

/**
 * loop/v1 M4: optional `YYYY-MM-DD` query param that must be a real calendar
 * date (2026-02-30 and 2026-13-01 are rejected). Invalid → 400 VALIDATION.
 */
export function optionalDateQuery(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const ok =
    m != null &&
    (() => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
    })();
  if (!ok) throw new AppError(ERROR_CODES.VALIDATION, `Fecha inválida en ${name} (usa AAAA-MM-DD).`);
  return value;
}
