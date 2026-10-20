import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import request from "supertest";
import { configureHttp } from "../http-setup";
import { DiagController } from "./diag.controller";

async function boot(env: Record<string, string>) {
  const mod = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60000, limit: 2 }] })],
    controllers: [DiagController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configureHttp(app, env);
  await app.init();
  return app;
}

describe("GET /diag/ip", () => {
  const prev = process.env.DIAG_IP_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.DIAG_IP_ENABLED;
    else process.env.DIAG_IP_ENABLED = prev;
  });

  it("404 when DIAG_IP_ENABLED is unset or not 'true'", async () => {
    for (const v of [undefined, "1", "false"]) {
      if (v === undefined) delete process.env.DIAG_IP_ENABLED;
      else process.env.DIAG_IP_ENABLED = v;
      const app = await boot({});
      await request(app.getHttpServer()).get("/diag/ip").expect(404);
      await app.close();
    }
  });

  it("returns only ip, ips, xForwardedFor and trustProxy when enabled", async () => {
    process.env.DIAG_IP_ENABLED = "true";
    const app = await boot({ TRUST_PROXY_HOPS: "1" });
    const res = await request(app.getHttpServer())
      .get("/diag/ip")
      .set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
      .set("Authorization", "Bearer secret-token")
      .set("Cookie", "sid=abc")
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual(["ip", "ips", "trustProxy", "xForwardedFor"]);
    expect(res.body.xForwardedFor).toBe("203.0.113.7, 10.0.0.2");
    expect(res.body.trustProxy).toBe(1);
    expect(res.body.ip).toBe("10.0.0.2");
    expect(JSON.stringify(res.body)).not.toMatch(/secret-token|sid=abc/);
    await app.close();
  });

  it("is rate-limited", async () => {
    process.env.DIAG_IP_ENABLED = "true";
    const app = await boot({});
    const s = app.getHttpServer();
    await request(s).get("/diag/ip").expect(200);
    await request(s).get("/diag/ip").expect(200);
    await request(s).get("/diag/ip").expect(429);
    await app.close();
  });
});
