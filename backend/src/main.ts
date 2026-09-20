import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config as loadEnv } from "dotenv";
import { AppModule } from "./app.module";
import { installBigIntJson } from "./shared/bigint";
import { HttpErrorFilter } from "./shared/http/http-error.filter";
import { requireJwtSecrets } from "./identity/jwt-secrets";

installBigIntJson();
loadEnv({ path: ".env" });

function originAllowed(origin: string): boolean {
  const extra = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;
  if (origin === "https://dulcecalle.vercel.app") return true;
  if (/^https:\/\/dulcecalle(-[a-z0-9-]+)?\.vercel\.app$/i.test(origin)) {
    return true;
  }
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return false;
}

async function bootstrap() {
  requireJwtSecrets();
  const app = await NestFactory.create(AppModule);
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
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || originAllowed(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error(`CORS blocked: ${origin}`), false);
    },
    credentials: true,
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Business-Id",
    ],
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
