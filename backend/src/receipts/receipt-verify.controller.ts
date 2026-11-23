import { Controller, Get, Param } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../shared/http/decorators";
import { ReceiptsService } from "./receipts.service";

/**
 * Throttle window for public verification. SPEC-C09 §4: own bucket of
 * 10/min per IP. VERIFY_THROTTLE_TTL_MS only shortens the window outside
 * production (e2e observes the reset); production is always 60 s.
 */
export function verifyThrottleTtl(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.VERIFY_THROTTLE_TTL_MS);
  return env.NODE_ENV !== "production" && Number.isInteger(v) && v > 0 ? v : 60000;
}

/**
 * C09-PR5 — GET /v1/receipts/verify/:code (public, SPEC-C09 §4). Answers
 * only {valid, kind, number, amount, createdAt, businessName, status,
 * hashPrefix}; unknown and malformed codes get one identical 404.
 */
@Controller("receipts")
export class ReceiptVerifyController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: () => verifyThrottleTtl() } })
  @Get("verify/:code")
  verify(@Param("code") code: string) {
    return this.receipts.verify(code);
  }
}
