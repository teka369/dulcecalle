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

describe("registration throttle", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;

  beforeAll(async () => {
    delete process.env.DISABLE_THROTTLE;
    delete process.env.MAIL_HOST;
    if (process.env.E2E_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    } else {
      pg = await startLocalPostgres();
      process.env.DATABASE_URL = pg.url;
    }
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
  }, 180000);

  afterAll(async () => {
    process.env.DISABLE_THROTTLE = "1";
    await app?.close();
    pg?.stop();
  });

  it("limits registration posts per IP and still answers the honeypot with the generic body", async () => {
    const api = request(app.getHttpServer());
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await api.post("/v1/auth/register").send({
        name: "Bot",
        email: `bot${i}@test.co`,
        password: "clave1234",
        confirmPassword: "clave1234",
        companyWebsite: "http://spam.test",
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 8).every((s) => s === 201)).toBe(true);
    expect(statuses[8]).toBe(429);
  });
});
