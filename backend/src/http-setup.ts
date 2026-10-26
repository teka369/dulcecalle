import { PAGING_HEADERS } from "./shared/http/paging-headers.interceptor";
import type { NestExpressApplication } from "@nestjs/platform-express";

type Env = Partial<Record<string, string | undefined>>;

/**
 * Render puts one proxy hop we must trust in front of the app (Cloudflare →
 * Render LB → app; Render documents `trust proxy` = 1). With it, `req.ip` /
 * `req.ips` come from the X-Forwarded-For entry Render appended, so the
 * ThrottlerGuard keys on the real client instead of one shared proxy bucket,
 * and a client cannot spoof the left-most entry. Override with
 * TRUST_PROXY_HOPS only after checking `req.ip` on a deployed Preview.
 */
export function trustProxyHops(env: Env = process.env): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  const n = raw ? Number(raw) : 1;
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** Production PWA. */
const PROD_ORIGIN = "https://dulcecalle.vercel.app";
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
  app.set("trust proxy", trustProxyHops(env));
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
