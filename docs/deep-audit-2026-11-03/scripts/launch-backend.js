// QA launcher: boots built backend (dist) like main.ts, seeds one owner, writes session to /tmp/qa-owner.json
const D = "/workspace/deep-audit/qa/dulcecalle/backend/dist";
process.chdir("/workspace/deep-audit/qa/dulcecalle/backend");
const { ValidationPipe } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require(D + "/app.module");
const { installBigIntJson } = require(D + "/shared/bigint");
const { HttpErrorFilter } = require(D + "/shared/http/http-error.filter");
const { configureHttp } = require(D + "/http-setup");
const { IdentityService } = require(D + "/identity/identity.service");
installBigIntJson();
(async () => {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new HttpErrorFilter());
  await app.listen(Number(process.env.PORT), "127.0.0.1");
  const s = await app.get(IdentityService).register({ email: process.env.QA_EMAIL || "[REDACTED]", password: "[REDACTED]", businessName: "QA Tienda" });
  require("fs").writeFileSync(process.env.QA_OUT || "/tmp/qa-owner.json", JSON.stringify(s));
  console.log("READY", s.business.id);
})();
