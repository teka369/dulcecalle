import "reflect-metadata";
import { Controller, Get, Module, Req } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { configureHttp, originAllowed } from "./http-setup";

/** loop/v1 investigador #1/#2/#8: real client IP behind Render's proxy + explicit CORS list. */
@Controller()
class IpController {
  @Get("ip")
  ip(@Req() req: { ip?: string }) {
    return { ip: req.ip };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60_000, limit: 2 }] })],
  controllers: [IpController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class TinyModule {}

async function tinyApp(configure: boolean) {
  const app = await NestFactory.create<NestExpressApplication>(TinyModule, { logger: false });
  if (configure) configureHttp(app, { NODE_ENV: "production" });
  await app.init();
  return app;
}

describe("trust proxy (rate limit keyed on the real client IP)", () => {
  it("control: without trust proxy every client shares the proxy's bucket (the bug)", async () => {
    const app = await tinyApp(false);
    const http = request(app.getHttpServer());
    await http.get("/ip").set("X-Forwarded-For", "203.0.113.1").expect(200);
    await http.get("/ip").set("X-Forwarded-For", "203.0.113.2").expect(200);
    await http.get("/ip").set("X-Forwarded-For", "203.0.113.3").expect(429);
    await app.close();
  });

  it("with configureHttp: req.ip is the client Render appended, and buckets are per client", async () => {
    const app = await tinyApp(true);
    const http = request(app.getHttpServer());
    const res = await http.get("/ip").set("X-Forwarded-For", "203.0.113.1");
    expect(res.body.ip).toBe("203.0.113.1");
    await http.get("/ip").set("X-Forwarded-For", "203.0.113.1").expect(200);
    await http.get("/ip").set("X-Forwarded-For", "203.0.113.1").expect(429);
    // Another real client is not affected.
    await http.get("/ip").set("X-Forwarded-For", "203.0.113.2").expect(200);
    await app.close();
  });

  it("a spoofed left-most X-Forwarded-For entry does not mint a new bucket", async () => {
    const app = await tinyApp(true);
    const http = request(app.getHttpServer());
    for (const fake of ["1.1.1.1", "2.2.2.2"]) {
      await http.get("/ip").set("X-Forwarded-For", `${fake}, 198.51.100.9`).expect(200);
    }
    await http.get("/ip").set("X-Forwarded-For", "3.3.3.3, 198.51.100.9").expect(429);
    await app.close();
  });
});

describe("CORS allow-list", () => {
  const prod = { NODE_ENV: "production" };
  const dev = { NODE_ENV: "development" };
  it("allows prod and our team's Vercel previews", () => {
    expect(originAllowed("https://dulcecalle.vercel.app", prod)).toBe(true);
    expect(originAllowed("https://dulcecalle-abc123-teka369s-projects.vercel.app", prod)).toBe(true);
    expect(originAllowed("https://dulcecalle-git-loop-v1-teka369s-projects.vercel.app", prod)).toBe(true);
  });
  it("rejects any other Vercel project called dulcecalle-* (third-party accounts)", () => {
    expect(originAllowed("https://dulcecalle-evil.vercel.app", prod)).toBe(false);
    expect(originAllowed("https://dulcecalle-x-attacker-projects.vercel.app", prod)).toBe(false);
    expect(originAllowed("https://dulcecalle-abc-teka369s-projects.vercel.app.evil.com", prod)).toBe(false);
    expect(originAllowed("http://dulcecalle.vercel.app", prod)).toBe(false);
  });
  it("localhost only outside production", () => {
    expect(originAllowed("http://localhost:8080", prod)).toBe(false);
    expect(originAllowed("http://127.0.0.1:3000", prod)).toBe(false);
    expect(originAllowed("http://localhost:8080", dev)).toBe(true);
  });
  it("CORS_ORIGIN extras still work", () => {
    expect(originAllowed("https://staging.example.com", { NODE_ENV: "production", CORS_ORIGIN: "https://staging.example.com" })).toBe(true);
  });
  it("preflight from a foreign dulcecalle-* project gets no Access-Control-Allow-Origin", async () => {
    const app = await tinyApp(true);
    const http = request(app.getHttpServer());
    const bad = await http.options("/ip").set("Origin", "https://dulcecalle-evil.vercel.app").set("Access-Control-Request-Method", "GET");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const good = await http.options("/ip").set("Origin", "https://dulcecalle.vercel.app").set("Access-Control-Request-Method", "GET");
    expect(good.headers["access-control-allow-origin"]).toBe("https://dulcecalle.vercel.app");
    await app.close();
  });
});
