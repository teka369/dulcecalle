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
import { StatsModule } from "./stats/stats.module";
import { CustomerAccessModule } from "./customer-access/customer-access.module";
import { HealthController } from "./health/health.controller";
import { JwtAuthGuard } from "./identity/jwt.guard";
import { BusinessGuard } from "./tenancy/business.guard";
import { RolesGuard } from "./tenancy/roles.guard";
import { requireJwtSecrets } from "./identity/jwt-secrets";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env"] }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const { access } = requireJwtSecrets();
        return {
          secret: access,
          signOptions: { expiresIn: "15m" as const },
        };
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: 60000, limit: 120 }],
      skipIf: () => process.env.DISABLE_THROTTLE === "1",
    }),
    PrismaModule,
    TenancyModule,
    IdentityModule,
    CatalogModule,
    SalesModule,
    CashModule,
    StatsModule,
    CustomerAccessModule,
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
