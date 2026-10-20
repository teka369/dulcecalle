import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

const WINDOW_MS = 15 * 60 * 1000;
const FREE_ATTEMPTS = 5;
const MAX_COOLDOWN_MS = 15 * 60 * 1000;

export type ThrottlePolicy = { freeAttempts: number; windowMs: number; maxCooldownMs: number };
/** One client (IP) guessing one code: 5 free guesses, then exponential cooldown. */
export const IP_CODE_POLICY: ThrottlePolicy = { freeAttempts: FREE_ATTEMPTS, windowMs: WINDOW_MS, maxCooldownMs: MAX_COOLDOWN_MS };
/** One client (IP) across all codes: stops walking sequential codes (C1, C2, …). */
export const IP_POLICY: ThrottlePolicy = { freeAttempts: 20, windowMs: WINDOW_MS, maxCooldownMs: MAX_COOLDOWN_MS };

@Injectable()
export class PortalLoginThrottle {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consume one guess under an advisory lock. Parallel requests cannot all
   * pass the check before any of them is counted. The 5th guess is still
   * allowed; the next one, inside the same 15-minute window, is cooled.
   * Cooling expires with the window — it is not a permanent lockout.
   */
  async take(key: string, policy: ThrottlePolicy = IP_CODE_POLICY): Promise<"ok" | "cooled"> {
    const { freeAttempts, windowMs, maxCooldownMs } = policy;
    const bucket = this.bucket(key);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bucket}))`;
      const row = await tx.portalLoginThrottle.findUnique({ where: { bucket } });
      const now = new Date();
      const fresh = row != null && now.getTime() - row.windowStart.getTime() < windowMs;
      if (row?.cooldownUntil && row.cooldownUntil > now) return "cooled";
      if (fresh && row.failures >= freeAttempts) return "cooled";

      const failures = fresh && row ? row.failures + 1 : 1;
      let cooldownUntil: Date | null = null;
      if (failures >= freeAttempts) {
        const steps = failures - freeAttempts + 1;
        const ms = Math.min(30_000 * 2 ** (steps - 1), maxCooldownMs);
        cooldownUntil = new Date(now.getTime() + ms);
      }
      await tx.portalLoginThrottle.upsert({
        where: { bucket },
        create: {
          id: randomUUID(),
          bucket,
          failures,
          windowStart: now,
          cooldownUntil,
        },
        update: {
          failures,
          windowStart: fresh && row ? row.windowStart : now,
          cooldownUntil,
        },
      });
      return "ok";
    });
  }

  async reset(key: string) {
    const bucket = this.bucket(key);
    await this.prisma.portalLoginThrottle.updateMany({
      where: { bucket },
      data: { failures: 0, cooldownUntil: null, windowStart: new Date() },
    });
  }

  private bucket(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }
}

/**
 * True for loopback / private / link-local addresses. Behind Render, if
 * `trust proxy` is wrong, `req.ip` is the proxy (a private address) and every
 * client would share it: per-IP-only buckets must not apply then.
 */
export function isPrivateOrUnknownIp(ip: string | undefined | null): boolean {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/i, "");
  if (v === "::1" || v === "::" ) return true;
  if (/^(127|10)\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true; // CGNAT / some LBs
  if (/^f[cd][0-9a-f]{2}:/i.test(v) || /^fe80:/i.test(v)) return true;
  return false;
}
