import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { MailService } from "../src/identity/mail.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

function tokenFor(mail: MailService, to: string): string {
  const msg = [...mail.sent].reverse().find((m) => m.to === to && m.text.includes("token="));
  if (!msg) throw new Error(`no verification mail for ${to}`);
  const match = /token=([^\s]+)/.exec(msg.text);
  if (!match?.[1]) throw new Error("token missing");
  return decodeURIComponent(match[1]);
}

describe("registration approval", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let mail: MailService;
  let prisma: PrismaService;

  beforeAll(async () => {
    delete process.env.MAIL_HOST;
    process.env.REGISTRATION_ADMIN_EMAIL = "revisa@dulce.test";
    process.env.PLATFORM_ADMIN_EMAILS = "admin@dulce.test";
    process.env.APP_PUBLIC_URL = "https://dulcecalle.vercel.app";
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    mail = app.get(MailService);
    prisma = app.get(PrismaService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());

  function body(email: string, extra: Record<string, string> = {}) {
    return {
      name: "Ana Pérez",
      email,
      password: "clave1234",
      confirmPassword: "clave1234",
      companyWebsite: "",
      ...extra,
    };
  }

  it("rejects invalid payloads and a honeypot without storing anything", async () => {
    await api()
      .post("/v1/auth/register")
      .send(body("bad@test.co", { password: "short", confirmPassword: "short" }))
      .expect(400);
    await api()
      .post("/v1/auth/register")
      .send(body("mis@test.co", { confirmPassword: "otra-clave" }))
      .expect(400);
    const honeypot = await api()
      .post("/v1/auth/register")
      .send(body("bot@test.co", { companyWebsite: "http://spam.test" }))
      .expect(201);
    expect(honeypot.body.status).toBe("ACCEPTED");
    expect(await prisma.registrationRequest.count({ where: { email: "bot@test.co" } })).toBe(0);
    expect(await prisma.user.count({ where: { email: "bot@test.co" } })).toBe(0);
  });

  it("keeps an existing owner able to log in and does not open a second account", async () => {
    const seeded = await seedOwner(app, "legacy@test.co", "Puesto Viejo");
    expect(seeded.accessToken).toBeTruthy();
    await api()
      .post("/v1/auth/login")
      .send({ email: "legacy@test.co", password: "password12" })
      .expect(201);
    const again = await api().post("/v1/auth/register").send(body("legacy@test.co")).expect(201);
    expect(again.body.status).toBe("ACCEPTED");
    expect(await prisma.user.count({ where: { email: "legacy@test.co" } })).toBe(1);
    expect(await prisma.registrationRequest.count({ where: { email: "legacy@test.co" } })).toBe(0);
    expect(mail.sent.some((m) => m.to === "legacy@test.co" && m.subject.includes("Ya tienes cuenta"))).toBe(
      true,
    );
  });

  it("verifies once, waits for admin, then approves exactly one user", async () => {
    const email = "nueva@test.co";
    const created = await api().post("/v1/auth/register").send(body(email)).expect(201);
    expect(created.body.message).toContain("enlace");
    const requestRow = await prisma.registrationRequest.findUnique({ where: { email } });
    expect(requestRow?.status).toBe("PENDING_EMAIL_VERIFICATION");
    expect(requestRow?.emailTokenHash).toBeTruthy();
    expect(requestRow?.passwordHash.startsWith("$2")).toBe(true);
    expect(mail.sent.some((m) => m.subject.includes("por aprobar"))).toBe(false);
    expect(await prisma.user.count({ where: { email } })).toBe(0);

    await api()
      .post("/v1/auth/login")
      .send({ email, password: "clave1234" })
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("EMAIL_NOT_VERIFIED"));
    await api()
      .post("/v1/auth/login")
      .send({ email, password: "no-es-la-clave" })
      .expect(401);

    const token = tokenFor(mail, email);
    const verified = await api().post("/v1/auth/register/verify").send({ token }).expect(200);
    expect(verified.body.status).toBe("PENDING_ADMIN_APPROVAL");
    await api().post("/v1/auth/register/verify").send({ token }).expect(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    const adminMail = mail.sent.filter((m) => m.to === "revisa@dulce.test");
    expect(adminMail).toHaveLength(1);
    expect(adminMail[0]?.text).not.toContain("/approve");

    await api()
      .post("/v1/auth/login")
      .send({ email, password: "clave1234" })
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("PENDING_APPROVAL"));

    await api().get("/v1/admin/registrations").expect(401);
    const owner = await seedOwner(app, "staff@test.co", "Otra tienda");
    await api()
      .get("/v1/admin/registrations")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(403);
    await api()
      .post("/v1/admin/registrations/not-a-real-id/approve")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(403);

    const admin = await seedOwner(app, "admin@dulce.test", "Casa");
    const pending = await api()
      .get("/v1/admin/registrations")
      .query({ status: "PENDING_ADMIN_APPROVAL" })
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    const item = pending.body.find((row: { email: string }) => row.email === email);
    expect(item.emailVerifiedAt).toBeTruthy();
    expect(JSON.stringify(pending.body)).not.toContain("passwordHash");
    expect(JSON.stringify(pending.body)).not.toContain("$2");

    await api()
      .get(`/v1/admin/registrations/${item.id}/approve`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(404);

    const approved = await api()
      .post(`/v1/admin/registrations/${item.id}/approve`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(approved.body.idempotent).toBe(false);
    const again = await api()
      .post(`/v1/admin/registrations/${item.id}/approve`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(again.body).toMatchObject({
      idempotent: true,
      userId: approved.body.userId,
      businessId: approved.body.businessId,
    });
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    const detail = await api()
      .get(`/v1/admin/registrations/${item.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(detail.body.decidedByEmail).toBe("admin@dulce.test");
    expect(detail.body.history.some((h: { action: string }) => h.action === "approved")).toBe(true);

    const login = await api().post("/v1/auth/login").send({ email, password: "clave1234" }).expect(201);
    expect(login.body.accessToken).toBeTruthy();
    const me = await api().get("/v1/me").set("Authorization", `Bearer ${login.body.accessToken}`).expect(200);
    expect(me.body.platformAdmin).toBe(false);
    expect(me.body.memberships[0].role).toBe("owner");
    expect(me.body.memberships[0].business.name).toBe("Ana Pérez");
  });

  it("rotates the verification token, expires the old one, and rejects a request", async () => {
    const email = "rota@test.co";
    await api().post("/v1/auth/register").send(body(email, { name: "Luis Gómez" })).expect(201);
    const first = tokenFor(mail, email);
    await prisma.registrationRequest.update({
      where: { email },
      data: { lastResendAt: new Date(Date.now() - 120_000) },
    });
    await api().post("/v1/auth/register/resend").send({ email }).expect(200);
    await api().post("/v1/auth/register/resend").send({ email }).expect(200);
    const second = tokenFor(mail, email);
    expect(second).not.toBe(first);
    await api().post("/v1/auth/register/verify").send({ token: first }).expect(400);
    await prisma.registrationRequest.update({
      where: { email },
      data: { emailTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    await api()
      .post("/v1/auth/register/verify")
      .send({ token: second })
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("REGISTRATION_EXPIRED"));

    const email2 = "nope@test.co";
    await api().post("/v1/auth/register").send(body(email2, { name: "Nora Díaz" })).expect(201);
    const token = tokenFor(mail, email2);
    await api().post("/v1/auth/register/verify").send({ token }).expect(200);
    const admin = await api().post("/v1/auth/login").send({ email: "admin@dulce.test", password: "password12" }).expect(201);
    const list = await api()
      .get("/v1/admin/registrations")
      .query({ status: "PENDING_ADMIN_APPROVAL" })
      .set("Authorization", `Bearer ${admin.body.accessToken}`)
      .expect(200);
    const item = list.body.find((row: { email: string }) => row.email === email2);
    await api()
      .post(`/v1/admin/registrations/${item.id}/reject`)
      .set("Authorization", `Bearer ${admin.body.accessToken}`)
      .send({ note: "No es un negocio de dulces." })
      .expect(200);
    await api()
      .post(`/v1/admin/registrations/${item.id}/reject`)
      .set("Authorization", `Bearer ${admin.body.accessToken}`)
      .send({})
      .expect(200)
      .expect((r) => expect(r.body.idempotent).toBe(true));
    await api()
      .post(`/v1/admin/registrations/${item.id}/approve`)
      .set("Authorization", `Bearer ${admin.body.accessToken}`)
      .expect(409);
    await api()
      .post("/v1/auth/login")
      .send({ email: email2, password: "clave1234" })
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("REGISTRATION_REJECTED"));
    expect(await prisma.user.count({ where: { email: email2 } })).toBe(0);
    expect(mail.sent.some((m) => m.to === email2 && m.subject.includes("no aprobada"))).toBe(true);
  });

  it("rolls back the request when the verification email cannot be sent", async () => {
    mail.failNextSend = true;
    await api()
      .post("/v1/auth/register")
      .send(body("falla@test.co"))
      .expect(503)
      .expect((r) => expect(r.body.error.code).toBe("MAIL_UNAVAILABLE"));
    expect(await prisma.registrationRequest.count({ where: { email: "falla@test.co" } })).toBe(0);
  });

  it("does not send a second admin notice for the same verified request", async () => {
    const email = "dup-admin@test.co";
    await api().post("/v1/auth/register").send(body(email)).expect(201);
    const before = mail.sent.filter((m) => m.to === "revisa@dulce.test").length;
    await api().post("/v1/auth/register/verify").send({ token: tokenFor(mail, email) }).expect(200);
    await api().post("/v1/auth/register").send(body(email)).expect(201);
    const after = mail.sent.filter((m) => m.to === "revisa@dulce.test").length;
    expect(after - before).toBe(1);
  });
});
