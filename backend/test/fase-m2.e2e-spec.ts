import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { requireJwtSecrets } from "../src/identity/jwt-secrets";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { HttpRepository } from "../../src/data/http/repository";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

installBigIntJson();

describe("Fase M2 jwt secrets", () => {
  const snapshot = () => ({
    access: process.env.JWT_SECRET,
    refresh: process.env.JWT_REFRESH_SECRET,
  });
  const restore = (s: { access?: string; refresh?: string }) => {
    if (s.access === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = s.access;
    if (s.refresh === undefined) delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = s.refresh;
  };

  it("fails closed when JWT_SECRET is missing", () => {
    const prev = snapshot();
    try {
      delete process.env.JWT_SECRET;
      process.env.JWT_REFRESH_SECRET = "refresh-only";
      expect(() => requireJwtSecrets()).toThrow(
        "JWT_SECRET and JWT_REFRESH_SECRET are required.",
      );
    } finally {
      restore(prev);
    }
  });

  it("fails closed when JWT_REFRESH_SECRET is blank", () => {
    const prev = snapshot();
    try {
      process.env.JWT_SECRET = "access-only";
      process.env.JWT_REFRESH_SECRET = "   ";
      expect(() => requireJwtSecrets()).toThrow(
        "JWT_SECRET and JWT_REFRESH_SECRET are required.",
      );
    } finally {
      restore(prev);
    }
  });

  it("returns both secrets when set", () => {
    const prev = snapshot();
    try {
      process.env.JWT_SECRET = "access-secret";
      process.env.JWT_REFRESH_SECRET = "refresh-secret";
      expect(requireJwtSecrets()).toEqual({
        access: "access-secret",
        refresh: "refresh-secret",
      });
    } finally {
      restore(prev);
    }
  });
});

describe("Fase M2 auth + session", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let jwt: JwtService;

  beforeAll(async () => {
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
    jwt = app.get(JwtService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());

  async function registerUser(email: string, businessName: string) {
    const res = await api()
      .post("/v1/auth/register")
      .send({ email, password: "password12", businessName })
      .expect(201);
    return res.body as {
      user: { id: string; email: string };
      business: { id: string; name: string };
      accessToken: string;
      refreshToken: string;
    };
  }

  it("register + login issue access and refresh tokens", async () => {
    const reg = await registerUser("m2-a@test.co", "Puesto M2 A");
    expect(reg.accessToken).toBeTruthy();
    expect(reg.refreshToken).toBeTruthy();
    expect(reg.user.email).toBe("m2-a@test.co");

    const login = await api()
      .post("/v1/auth/login")
      .send({ email: "m2-a@test.co", password: "password12" })
      .expect(201);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeTruthy();
    expect(login.body.user.email).toBe("m2-a@test.co");
  });

  it("POST /v1/auth/refresh rotates tokens and rejects access/invalid/empty", async () => {
    const reg = await registerUser("m2-refresh@test.co", "Puesto Refresh");

    const ok = await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: reg.refreshToken })
      .expect(201);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.refreshToken).toBeTruthy();
    expect(ok.body.user.email).toBe("m2-refresh@test.co");

    await api()
      .get("/v1/me")
      .set("Authorization", `Bearer ${ok.body.accessToken}`)
      .expect(200)
      .expect((r) => expect(r.body.email).toBe("m2-refresh@test.co"));

    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: reg.refreshToken })
      .expect(201);

    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: reg.accessToken })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("UNAUTHORIZED"));

    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: "not-a-jwt" })
      .expect(401);

    await api().post("/v1/auth/refresh").send({}).expect(400);

    const expiredRefresh = jwt.sign(
      { sub: reg.user.id, email: reg.user.email, typ: "refresh" },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: "-1s" },
    );
    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: expiredRefresh })
      .expect(401);
  });

  it("refresh token is rejected as Bearer; access without typ still works", async () => {
    const reg = await registerUser("m2-bearer@test.co", "Puesto Bearer");

    await api()
      .get("/v1/me")
      .set("Authorization", `Bearer ${reg.refreshToken}`)
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("UNAUTHORIZED"));

    await api()
      .get("/v1/me")
      .set("Authorization", `Bearer ${reg.accessToken}`)
      .expect(200);
  });

  it("logout is client-side: endpoint returns ok, access JWT still works", async () => {
    const reg = await registerUser("m2-logout@test.co", "Puesto Logout");

    await api()
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${reg.accessToken}`)
      .expect(201)
      .expect((r) => expect(r.body.ok).toBe(true));

    await api()
      .get("/v1/me")
      .set("Authorization", `Bearer ${reg.accessToken}`)
      .expect(200)
      .expect((r) => expect(r.body.email).toBe("m2-logout@test.co"));
  });

  it("tenant isolation still uses X-Business-Id membership", async () => {
    const a = await registerUser("m2-ten-a@test.co", "Negocio A");
    const b = await registerUser("m2-ten-b@test.co", "Negocio B");

    await api()
      .get("/v1/products")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .set("X-Business-Id", b.business.id)
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("FORBIDDEN"));

    await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .set("X-Business-Id", a.business.id)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Cola A", price: 1000, stock: 2, avgCost: 400 })
      .expect(201);
  });

  it("HttpRepository login auto-selects the only business; 401 refreshes once", async () => {
    const base = `${await app.getUrl()}/v1`;
    const repo = new HttpRepository(base);
    const reg = await repo.auth.register({
      email: "m2-http@test.co",
      password: "password12",
      businessName: "Puesto HTTP",
    });
    const biz = repo.session.businessId;
    expect(biz).toBe(reg.business.id);

    await repo.auth.logout();
    expect(repo.session.accessToken).toBeNull();
    expect(repo.session.refreshToken).toBeNull();
    expect(repo.session.businessId).toBeNull();
    expect(repo.session.user).toBeNull();

    const logged = await repo.auth.login("m2-http@test.co", "password12");
    expect(logged.memberships).toHaveLength(1);
    expect(repo.session.businessId).toBe(biz);
    expect(repo.session.accessToken).toBeTruthy();

    const expiredAccess = jwt.sign(
      { sub: logged.user.id, email: logged.user.email },
      { expiresIn: "-1s" },
    );
    const previousRefresh = repo.session.refreshToken;
    repo.session.accessToken = expiredAccess;

    const me = await repo.auth.me();
    expect(me.email).toBe("m2-http@test.co");
    expect(repo.session.accessToken).toBeTruthy();
    expect(repo.session.accessToken).not.toBe(expiredAccess);
    expect(repo.session.refreshToken).toBeTruthy();
    expect(previousRefresh).toBeTruthy();
  });

  it("account B after A does not keep A's businessId", async () => {
    const base = `${await app.getUrl()}/v1`;
    const repo = new HttpRepository(base);

    const a = await repo.auth.register({
      email: "m2-switch-a@test.co",
      password: "password12",
      businessName: "Negocio Switch A",
    });
    expect(repo.session.businessId).toBe(a.business.id);

    const b = await registerUser("m2-switch-b@test.co", "Negocio Switch B");
    await api()
      .post("/v1/businesses")
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ name: "Negocio Switch B2" })
      .expect(201);

    const loggedB = await repo.auth.login("m2-switch-b@test.co", "password12");
    expect(loggedB.memberships).toHaveLength(2);
    expect(repo.session.user?.email).toBe("m2-switch-b@test.co");
    expect(repo.session.businessId).toBeNull();
    expect(repo.session.businessId).not.toBe(a.business.id);

    await repo.auth.logout();
    expect(repo.session.businessId).toBeNull();

    const loggedA = await repo.auth.login("m2-switch-a@test.co", "password12");
    expect(loggedA.memberships).toHaveLength(1);
    expect(repo.session.businessId).toBe(a.business.id);
    expect(repo.session.user?.email).toBe("m2-switch-a@test.co");
  });
});
