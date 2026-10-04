import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

const PIN = "918273";

describe("portal PIN and revocable sessions", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let jwt: JwtService;
  let prisma: PrismaService;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.DISABLE_THROTTLE = "1";
    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.listen(0, "127.0.0.1");
    jwt = app.get(JwtService);
    prisma = app.get(PrismaService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());

  async function customerWithPin(
    token: string,
    businessId: string,
    name: string,
    pin = PIN,
  ) {
    const created = await api()
      .post("/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Business-Id", businessId)
      .set("Idempotency-Key", randomUUID())
      .send({ name })
      .expect(201);
    await api()
      .post(`/v1/customers/${created.body.id}/pin`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Business-Id", businessId)
      .send({ pin })
      .expect(201);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(row.pinHash).toBeTruthy();
    expect(row.pinHash).not.toBe(pin);
    expect(row.pinHash?.startsWith("$2")).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain(pin);
    return created.body as { id: string; code: string; name: string };
  }

  it("logs in with code + PIN and hides the PIN from the response and the database", async () => {
    const owner = await seedOwner(app, "pin-ok@test.co", "PIN OK");
    const logs: string[] = [];
    const spy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const customer = await customerWithPin(owner.accessToken, owner.business.id, "Rosa");
    const res = await api()
      .post("/v1/customer-access/login")
      .send({ code: customer.code, pin: PIN })
      .expect(201);
    spy.mockRestore();
    expect(res.body.customer.id).toBe(customer.id);
    expect(res.body.business.id).toBe(owner.business.id);
    expect(JSON.stringify(res.body)).not.toContain(PIN);
    expect(logs.join("\n")).not.toContain(PIN);
    const sessions = await prisma.authSession.count({
      where: { subjectId: customer.id, kind: "customer", revokedAt: null },
    });
    expect(sessions).toBe(1);
  });

  it("uses one message for a bad PIN, a missing code, and a customer without a PIN", async () => {
    const owner = await seedOwner(app, "pin-enum@test.co", "Enum");
    const customer = await customerWithPin(owner.accessToken, owner.business.id, "Ana");
    const plain = await api()
      .post("/v1/customers")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .set("X-Business-Id", owner.business.id)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Sin PIN" })
      .expect(201);
    const wrong = await api()
      .post("/v1/customer-access/login")
      .send({ code: customer.code, pin: "000000" })
      .expect(401);
    const missing = await api()
      .post("/v1/customer-access/login")
      .send({ code: "DC-9999", pin: PIN })
      .expect(401);
    const noPin = await api()
      .post("/v1/customer-access/login")
      .send({ code: plain.body.code, pin: PIN })
      .expect(401);
    expect(wrong.body.error.message).toBe("No pudimos identificarte.");
    expect(missing.body.error).toEqual(wrong.body.error);
    expect(noPin.body.error).toEqual(wrong.body.error);
  });

  it("cools a code down without caring about forwarded IP headers", async () => {
    const owner = await seedOwner(app, "pin-cool@test.co", "Cool");
    const customer = await customerWithPin(owner.accessToken, owner.business.id, "Teo");
    for (let i = 0; i < 5; i += 1) {
      const res = await api()
        .post("/v1/customer-access/login")
        .set("X-Forwarded-For", `203.0.113.${i}`)
        .set("X-Real-IP", `198.51.100.${i}`)
        .send({ code: customer.code, pin: "000000", businessId: owner.business.id });
      expect(res.status).toBe(401);
    }
    const cooled = await api()
      .post("/v1/customer-access/login")
      .set("X-Forwarded-For", "203.0.113.200")
      .set("X-Real-IP", "198.51.100.200")
      .send({ code: customer.code, pin: PIN, businessId: owner.business.id })
      .expect(429);
    expect(cooled.body.error.code).toBe("RATE_LIMIT");
    const other = await api()
      .post("/v1/customer-access/login")
      .send({ code: "DC-8888", pin: "000000" })
      .expect(401);
    expect(other.body.error.code).toBe("UNAUTHORIZED");
  });

  it("does not let a parallel burst spend more than five guesses", async () => {
    const owner = await seedOwner(app, "pin-burst@test.co", "Burst");
    const customer = await customerWithPin(owner.accessToken, owner.business.id, "Rafa");
    const burst = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        api()
          .post("/v1/customer-access/login")
          .set("X-Forwarded-For", `198.51.100.${i}`)
          .set("X-Real-IP", `203.0.113.${i}`)
          .send({
            code: customer.code,
            pin: String(100000 + i),
            businessId: owner.business.id,
          }),
      ),
    );
    const unauthorized = burst.filter((res) => res.status === 401);
    const cooled = burst.filter((res) => res.status === 429);
    expect(burst.some((res) => res.status === 201 || res.status === 500)).toBe(false);
    expect(unauthorized.length).toBeLessThanOrEqual(5);
    expect(cooled.length).toBe(burst.length - unauthorized.length);
    expect(cooled.every((res) => res.body.error.code === "RATE_LIMIT")).toBe(true);
  }, 60_000);

  it("does not let a PIN from business A open business B", async () => {
    const a = await seedOwner(app, "pin-a@test.co", "Negocio A");
    const b = await seedOwner(app, "pin-b@test.co", "Negocio B");
    const left = await customerWithPin(a.accessToken, a.business.id, "Rosa", "111111");
    const right = await customerWithPin(b.accessToken, b.business.id, "Rosa", "222222");
    expect(left.code).toBe(right.code);
    const asB = await api()
      .post("/v1/customer-access/login")
      .send({ code: left.code, pin: "111111", businessId: b.business.id })
      .expect(401);
    expect(asB.body.error.message).toBe("No pudimos identificarte.");
    const asA = await api()
      .post("/v1/customer-access/login")
      .send({ code: left.code, pin: "111111", businessId: a.business.id })
      .expect(201);
    expect(asA.body.customer.id).toBe(left.id);
    expect(asA.body.business.id).toBe(a.business.id);

    const forged = jwt.sign({
      sub: left.id,
      businessId: b.business.id,
      typ: "customer",
    });
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${forged}`)
      .expect(401);
    await api()
      .get("/v1/customers")
      .set("Authorization", `Bearer ${asA.body.accessToken}`)
      .set("X-Business-Id", a.business.id)
      .expect(401);
  });

  it("replaces a PIN and keeps the previous one dead", async () => {
    const owner = await seedOwner(app, "pin-reset@test.co", "Reset");
    const customer = await customerWithPin(owner.accessToken, owner.business.id, "Luz");
    const open = await api()
      .post("/v1/customer-access/login")
      .send({ code: customer.code, pin: PIN, businessId: owner.business.id })
      .expect(201);
    await api()
      .post(`/v1/customers/${customer.id}/pin`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .set("X-Business-Id", owner.business.id)
      .send({ pin: "333333" })
      .expect(201);
    await api()
      .post("/v1/customer-access/refresh")
      .send({ refreshToken: open.body.refreshToken })
      .expect(401);
    await api()
      .post("/v1/customer-access/login")
      .send({ code: customer.code, pin: PIN, businessId: owner.business.id })
      .expect(401);
    const next = await api()
      .post("/v1/customer-access/login")
      .send({ code: customer.code, pin: "333333", businessId: owner.business.id })
      .expect(201);
    expect(next.body.customer.id).toBe(customer.id);
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(stored.pinHash).not.toContain("333333");
  });

  it("revokes one refresh session and leaves the other device working", async () => {
    const owner = await seedOwner(app, "sess-two@test.co", "Sesiones");
    const first = await api()
      .post("/v1/auth/login")
      .send({ email: "sess-two@test.co", password: "password12" })
      .expect(201);
    const second = await api()
      .post("/v1/auth/login")
      .send({ email: "sess-two@test.co", password: "password12" })
      .expect(201);
    expect(first.body.refreshToken).not.toBe(second.body.refreshToken);
    await api()
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${first.body.accessToken}`)
      .send({ refreshToken: first.body.refreshToken })
      .expect(201);
    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);
    const still = await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: second.body.refreshToken })
      .expect(201);
    expect(still.body.user.email).toBe("sess-two@test.co");
    const row = await prisma.authSession.findFirst({
      where: { subjectId: owner.user.id, revokedAt: { not: null } },
    });
    expect(row?.revokedAt).toBeTruthy();

    const parallel = await Promise.all(
      Array.from({ length: 10 }, () =>
        api().post("/v1/auth/refresh").send({ refreshToken: second.body.refreshToken }),
      ),
    );
    expect(parallel.every((res) => res.status === 201)).toBe(true);
    expect(parallel.some((res) => res.status === 500)).toBe(false);

    await prisma.authSession.updateMany({
      where: { subjectId: owner.user.id, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);

    const tampered = `${second.body.refreshToken}x`;
    await api().post("/v1/auth/refresh").send({ refreshToken: tampered }).expect(401);
    const wrongKey = jwt.sign(
      { sub: owner.user.id, email: owner.user.email, typ: "refresh", sid: randomUUID() },
      { secret: "other-secret", expiresIn: "7d" },
    );
    await api().post("/v1/auth/refresh").send({ refreshToken: wrongKey }).expect(401);
  });

  it("rejects a customer refresh on the owner endpoint and drops access when membership is gone", async () => {
    const owner = await seedOwner(app, "sess-role@test.co", "Roles");
    const customer = await customerWithPin(owner.accessToken, owner.business.id, "Nia");
    const portal = await api()
      .post("/v1/customer-access/login")
      .send({ code: customer.code, pin: PIN, businessId: owner.business.id })
      .expect(201);
    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: portal.body.refreshToken })
      .expect(401);
    await api()
      .post("/v1/customer-access/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(401);

    await prisma.businessMembership.deleteMany({
      where: { userId: owner.user.id, businessId: owner.business.id },
    });
    await api()
      .get("/v1/customers")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .set("X-Business-Id", owner.business.id)
      .expect(403);
    const refreshed = await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(201);
    await api()
      .get("/v1/customers")
      .set("Authorization", `Bearer ${refreshed.body.accessToken}`)
      .set("X-Business-Id", owner.business.id)
      .expect(403);
  });
});
