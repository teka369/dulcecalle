/**
 * loop/v1 security headers (next.config `headers()`).
 *
 * script-src keeps 'unsafe-inline' on purpose: the App Router streams inline
 * `self.__next_f.push(...)` scripts and we ship one inline boot script. A nonce
 * needs per-request middleware, which turns every route dynamic and breaks the
 * offline-first model (SW-precached HTML would carry a stale nonce, static
 * pages could no longer be prerendered). Risk is contained by: no
 * 'unsafe-eval', object-src 'none', base-uri 'self', form-action 'self',
 * frame-ancestors 'none', and connect-src limited to our API + Cloudinary.
 */
import { PRODUCTION_API_ORIGIN } from "./data/backend";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null; // relative "/v1" → covered by 'self'
  }
}

export function contentSecurityPolicy(env: Partial<Record<string, string | undefined>> = process.env): string {
  const api = new Set<string>([PRODUCTION_API_ORIGIN]);
  const fromEnv = originOf(env.NEXT_PUBLIC_API_URL?.trim());
  if (fromEnv) api.add(fromEnv);
  const dev = env.NODE_ENV === "development";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", "https://api.fontshare.com"],
    "font-src": ["'self'", "data:", "https://cdn.fontshare.com", "https://api.fontshare.com"],
    "img-src": ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
    "connect-src": ["'self'", ...api, "https://api.cloudinary.com", ...(dev ? ["ws:", "http://127.0.0.1:3000"] : [])],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export function securityHeaders(env: Partial<Record<string, string | undefined>> = process.env) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ];
}
