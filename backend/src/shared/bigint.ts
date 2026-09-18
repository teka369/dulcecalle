/**
 * BigInt JSON policy (Fase 6):
 * COP is stored as PostgreSQL BIGINT / Prisma BigInt.
 * HTTP JSON emits a number (e.g. "saleTotal": 12500), not a string.
 * Amounts that exceed Number.MAX_SAFE_INTEGER throw rather than silently
 * round — a candy cart will not hit that ceiling.
 */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => number };
  proto.toJSON = function toJSON(this: bigint) {
    const v = Number(this);
    if (!Number.isSafeInteger(v)) {
      throw new Error("COP out of JSON-safe integer range");
    }
    return v;
  };
}
