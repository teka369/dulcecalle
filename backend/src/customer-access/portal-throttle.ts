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

/**
 * Soft cap per CUSTOMER, from any IP (a distributed guess at one PIN). It
 * never blocks: after `freeFailures` failures in the window each attempt on
 * that customer waits a growing delay (capped) and we log an alert.
 */
export const CUSTOMER_SOFT_CAP = { freeFailures: 10, windowMs: 60 * 60 * 1000, baseDelayMs: 250, maxDelayMs: 4000 };

export function softDelayMs(priorFailures: number): number {
  const { freeFailures, baseDelayMs, maxDelayMs } = CUSTOMER_SOFT_CAP;
  if (priorFailures < freeFailures) return 0;
  return Math.min(baseDelayMs * 2 ** Math.min(priorFailures - freeFailures, 16), maxDelayMs);
}

/** Alert at 10, 25, 50, then every 100 failures in the window. */
export function softCapAlert(failures: number): boolean {
  return failures === 10 || failures === 25 || failures === 50 || (failures > 0 && failures % 100 === 0);
}

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

  /** Failures counted for `key` inside the window (0 when stale). Never blocks. */
  async peek(key: string, windowMs: number): Promise<number> {
    const row = await this.prisma.portalLoginThrottle.findUnique({ where: { bucket: this.bucket(key) } });
    if (!row || Date.now() - row.windowStart.getTime() >= windowMs) return 0;
    return row.failures;
  }

  /** Count one failure for `key` (new window when stale). Never sets a cooldown. */
  async bump(key: string, windowMs: number): Promise<void> {
    const bucket = this.bucket(key);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bucket}))`;
      const row = await tx.portalLoginThrottle.findUnique({ where: { bucket } });
      const now = new Date();
      const fresh = row != null && now.getTime() - row.windowStart.getTime() < windowMs;
      await tx.portalLoginThrottle.upsert({
        where: { bucket },
        create: { id: randomUUID(), bucket, failures: 1, windowStart: now, cooldownUntil: null },
        update: { failures: fresh && row ? row.failures + 1 : 1, windowStart: fresh && row ? row.windowStart : now },
      });
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
