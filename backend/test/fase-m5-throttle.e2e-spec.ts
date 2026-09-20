import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

installBigIntJson();

describe("Fase M5 customer login throttle", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  const previousThrottle = process.env.DISABLE_THROTTLE;

  beforeAll(async () => {
    process.env.DISABLE_THROTTLE = "0";
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.listen(0, "127.0.0.1");
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
    if (previousThrottle === undefined) delete process.env.DISABLE_THROTTLE;
    else process.env.DISABLE_THROTTLE = previousThrottle;
  });

  it("returns 429 RATE_LIMIT on the 11th identification attempt", async () => {
    const http = request(app.getHttpServer());
    for (let i = 0; i < 10; i += 1) {
      const res = await http
        .post("/v1/customer-access/login")
        .send({ code: "DC-0001", name: "Nadie" });
      expect(res.status).not.toBe(429);
      expect(res.body.error?.code).not.toBe("RATE_LIMIT");
    }

    const blocked = await http
      .post("/v1/customer-access/login")
      .send({ code: "DC-0001", name: "Nadie" })
      .expect(429);
    expect(blocked.body.error.code).toBe("RATE_LIMIT");
  });
});
