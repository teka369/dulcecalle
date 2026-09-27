/**
 * Isolated Nest listener for the client→PostgreSQL harness.
 * Postgres is embedded unless E2E_DATABASE_URL is set (CI service).
 * In CI a dedicated database is created so the suite starts empty.
 * Does not load backend/.env over an already-set DATABASE_URL.
 */
import "reflect-metadata";
import { execSync } from "child_process";
import * as fs from "fs";
import type { AddressInfo } from "net";
import * as path from "path";
import { Client } from "pg";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

type ReadyFile = {
  baseUrl: string;
  databaseUrl: string;
  owner: {
    accessToken: string;
    refreshToken: string;
    userId: string;
    email: string;
    businessId: string;
  };
  otherBusinessId: string;
};

const readyPath = process.argv[2];
if (!readyPath) {
  throw new Error("ready file path is required");
}

function withDatabase(databaseUrl: string, name: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function recreateDatabase(adminUrl: string, name: string): Promise<string> {
  const url = new URL(adminUrl);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: "postgres",
  });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  return withDatabase(adminUrl, name);
}

let pg: PgHandle | null = null;

async function main(): Promise<void> {
  process.env.JWT_SECRET ??= "test-access-secret";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
  process.env.DISABLE_THROTTLE ??= "1";
  process.env.NODE_ENV = "test";

  let databaseUrl: string;
  if (process.env.E2E_DATABASE_URL) {
    databaseUrl = await recreateDatabase(process.env.E2E_DATABASE_URL, "dulcecalle_client_pg");
  } else {
    pg = await startLocalPostgres();
    databaseUrl = pg.url;
  }
  process.env.DATABASE_URL = databaseUrl;

  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
  });

  installBigIntJson();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: ["error"] });
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
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  const stamp = Date.now();
  const owner = await seedOwner(app, `client-pg-${stamp}@test.co`, "Cliente PG");
  const other = await seedOwner(app, `client-pg-b-${stamp}@test.co`, "Otro PG");
  const ready: ReadyFile = {
    baseUrl,
    databaseUrl,
    owner: {
      accessToken: owner.accessToken,
      refreshToken: owner.refreshToken,
      userId: owner.user.id,
      email: owner.user.email,
      businessId: owner.business.id,
    },
    otherBusinessId: other.business.id,
  };
  fs.writeFileSync(readyPath, JSON.stringify(ready));

  let closed = false;
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    try {
      await app.close();
    } catch {
      /* already closing */
    }
    pg?.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  await new Promise<void>(() => {});
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  try {
    pg?.stop();
  } catch {
    /* postgres already gone */
  }
  process.exit(1);
});
