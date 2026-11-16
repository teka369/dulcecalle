import { PAGING_HEADERS } from "./shared/http/paging-headers.interceptor";
import { isPrivatePeer } from "./shared/http/client-ip";
import type { NestExpressApplication } from "@nestjs/platform-express";

type Env = Partial<Record<string, string | undefined>>;

/**
 * C09-PR5.2 (Tester C09-PR5-T02) — `trust proxy` by PRIVATE SUBNET, not by
 * hop count. Render's proxy reaches the app from a private address; Express
 * walks X-Forwarded-For from the right and stops at the first address that
 * is not private, so behind Render `req.ip` is the Cloudflare edge Render
 * appended (the real client comes from CF-Connecting-IP, see client-ip.ts),
 * and a client-forged left-most entry is never reached. A PUBLIC direct peer
 * is not trusted at all: `req.ip` is the socket address and XFF is ignored.
 * (Replaces TRUST_PROXY_HOPS = 1, which trusted one hop even from a public
 * peer, so a forged XFF picked the bucket.)
 */
export function trustPrivateProxy(addr: string): boolean {
  return isPrivatePeer(addr);
}

/** Production PWA. */
export const PROD_ORIGIN = "https://dulcecalle.vercel.app";
/** Our team's Vercel previews only (deployment + git-branch URLs). */
const TEAM_PREVIEW = /^https:\/\/dulcecalle-[a-z0-9-]+-teka369s-projects\.vercel\.app$/i;
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export function originAllowed(origin: string, env: Env = process.env): boolean {
  const extra = (env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;
  if (origin === PROD_ORIGIN) return true;
  if (TEAM_PREVIEW.test(origin)) return true;
  if (env.NODE_ENV !== "production" && LOCALHOST.test(origin)) return true;
  return false;
}

export function configureHttp(app: NestExpressApplication, env: Env = process.env): void {
  app.set("trust proxy", trustPrivateProxy);
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // No Origin (curl, server-to-server, same-origin) is not a CORS request.
      if (!origin) return cb(null, true);
      // Disallowed: no CORS headers (browser blocks), no 500.
      cb(null, originAllowed(origin, env));
    },
    credentials: true,
    exposedHeaders: PAGING_HEADERS,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Business-Id"],
  });
}

/** B3: DISABLE_THROTTLE=1 is only honored outside production. */
export function shouldSkipThrottle(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.DISABLE_THROTTLE === "1";
}
