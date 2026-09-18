import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { IdentityModule } from "./identity/identity.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { CatalogModule } from "./catalog/catalog.module";
import { SalesModule } from "./sales/sales.module";
import { CashModule } from "./cash/cash.module";
import { HealthController } from "./health/health.controller";
import { JwtAuthGuard } from "./identity/jwt.guard";
import { BusinessGuard } from "./tenancy/business.guard";
import { RolesGuard } from "./tenancy/roles.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env"] }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "dev-access-secret",
      signOptions: { expiresIn: "15m" },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: 60000, limit: 120 }],
    }),
    PrismaModule,
    TenancyModule,
    IdentityModule,
    CatalogModule,
    SalesModule,
    CashModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: BusinessGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
