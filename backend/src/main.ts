import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { config as loadEnv } from "dotenv";
import { AppModule } from "./app.module";
import { installBigIntJson } from "./shared/bigint";
import { HttpErrorFilter } from "./shared/http/http-error.filter";
import { requireJwtSecrets } from "./identity/jwt-secrets";
import { configureHttp } from "./http-setup";

installBigIntJson();
loadEnv({ path: ".env" });

async function bootstrap() {
  requireJwtSecrets();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Trust Render's proxy hop (real client IP for rate limits) + explicit CORS list.
  configureHttp(app);
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

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
