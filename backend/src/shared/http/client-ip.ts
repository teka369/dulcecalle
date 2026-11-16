import { createParamDecorator, Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { isIP } from "net";

type Env = Partial<Record<string, string | undefined>>;
type ReqLike = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

/**
 * C09-PR5.1 (C09-INV-02) — every request to a Render web service crosses
 * Cloudflare, then Render's proxy (render.com/docs/ddos-protection,
 * render.com/articles/how-render-handles-ddos-attacks). Cloudflare APPENDS to
 * any X-Forwarded-For the client sent and then Render appends the Cloudflare
 * edge, so with `trust proxy` = 1 `req.ip` is a (varying) Cloudflare edge,
 * not the client. Cloudflare sets `CF-Connecting-IP` to the IP that connected
 * to it and overwrites any value the client sent
 * (developers.cloudflare.com/fundamentals/reference/http-headers/).
 *
 * So the client IP is that header, trusted ONLY when:
 * - it is enabled (CLIENT_IP_HEADER, default `cf-connecting-ip`; set it to
 *   `off` to go back to plain `req.ip`);
 * - the socket peer is a private/loopback address, i.e. the request came
 *   through Render's internal proxy and not straight from the internet;
 * - it holds exactly one valid IP.
 * Otherwise `req.ip` (trust proxy hops) is used, the pre-PR5.1 behaviour.
 */
export function clientIpHeader(env: Env = process.env): string | null {
  const raw = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (raw === "off" || raw === "none" || raw === "0") return null;
  return raw || "cf-connecting-ip";
}

export function isPrivatePeer(addr: string | undefined): boolean {
  if (!addr) return false;
  const v = addr.replace(/^::ffff:/i, "");
  if (v === "::1" || /^127\./.test(v) || /^10\./.test(v) || /^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(v);
}

export function clientIp(req: ReqLike, env: Env = process.env): string | undefined {
  const name = clientIpHeader(env);
  if (name && isPrivatePeer(req.socket?.remoteAddress)) {
    const raw = req.headers?.[name];
    const value = typeof raw === "string" ? raw.trim().replace(/^::ffff:/i, "") : "";
    if (value && isIP(value) !== 0) return value;
  }
  return req.ip;
}

/** `@ClientIp()` — the real client IP (see clientIp), for the portal PIN buckets. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  clientIp(ctx.switchToHttp().getRequest<ReqLike>()),
);

/** ThrottlerGuard keyed on the real client IP (same IPv6 /56 grouping as the default). */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = clientIp(req as ReqLike);
    return super.getTracker({ ...req, ip });
  }
}
