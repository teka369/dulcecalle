import { Controller, Get, NotFoundException, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public, SkipBusiness } from "../shared/http/decorators";

/**
 * TEMPORARY diagnostic to verify TRUST_PROXY_HOPS on a deployed Preview.
 * Off unless DIAG_IP_ENABLED === "true" (404 otherwise). Returns only the
 * resolved client IP data — no tokens, cookies, other headers or user data.
 * Rate-limited by the global ThrottlerGuard. Remove once verified.
 */
@Controller("diag")
export class DiagController {
  @Public()
  @SkipBusiness()
  @Get("ip")
  ip(@Req() req: Request) {
    if (process.env.DIAG_IP_ENABLED !== "true") throw new NotFoundException();
    const xff = req.headers["x-forwarded-for"];
    return {
      ip: req.ip ?? null,
      ips: req.ips,
      xForwardedFor: (Array.isArray(xff) ? xff.join(", ") : xff) ?? null,
      trustProxy: req.app.get("trust proxy") ?? null,
    };
  }
}
