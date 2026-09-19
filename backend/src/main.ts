import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config as loadEnv } from "dotenv";
import { AppModule } from "./app.module";
import { installBigIntJson } from "./shared/bigint";
import { HttpErrorFilter } from "./shared/http/http-error.filter";
import { requireJwtSecrets } from "./identity/jwt-secrets";

installBigIntJson();
loadEnv({ path: ".env" });

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
  const origin = process.env.CORS_ORIGIN ?? "http://localhost:8080";
  app.enableCors({
    origin,
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Business-Id"],
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
