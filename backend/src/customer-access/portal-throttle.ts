import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

const WINDOW_MS = 15 * 60 * 1000;
const FREE_ATTEMPTS = 5;
const MAX_COOLDOWN_MS = 15 * 60 * 1000;

@Injectable()
export class PortalLoginThrottle {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consume one guess under an advisory lock. Parallel requests cannot all
   * pass the check before any of them is counted. The 5th guess is still
   * allowed; the next one, inside the same 15-minute window, is cooled.
   * Cooling expires with the window — it is not a permanent lockout.
   */
  async take(key: string): Promise<"ok" | "cooled"> {
    const bucket = this.bucket(key);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bucket}))`;
      const row = await tx.portalLoginThrottle.findUnique({ where: { bucket } });
      const now = new Date();
      const fresh = row != null && now.getTime() - row.windowStart.getTime() < WINDOW_MS;
      if (row?.cooldownUntil && row.cooldownUntil > now) return "cooled";
      if (fresh && row.failures >= FREE_ATTEMPTS) return "cooled";

      const failures = fresh && row ? row.failures + 1 : 1;
      let cooldownUntil: Date | null = null;
      if (failures >= FREE_ATTEMPTS) {
        const steps = failures - FREE_ATTEMPTS + 1;
        const ms = Math.min(30_000 * 2 ** (steps - 1), MAX_COOLDOWN_MS);
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
