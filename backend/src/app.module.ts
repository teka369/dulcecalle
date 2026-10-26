import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { PagingHeadersInterceptor } from "./shared/http/paging-headers.interceptor";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { IdentityModule } from "./identity/identity.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { CatalogModule } from "./catalog/catalog.module";
import { BusinessModule } from "./business/business.module";
import { SalesModule } from "./sales/sales.module";
import { CashModule } from "./cash/cash.module";
import { StatsModule } from "./stats/stats.module";
import { CustomerAccessModule } from "./customer-access/customer-access.module";
import { HealthController } from "./health/health.controller";
import { DiagController } from "./diag/diag.controller";
import { JwtAuthGuard } from "./identity/jwt.guard";
import { BusinessGuard } from "./tenancy/business.guard";
import { RolesGuard } from "./tenancy/roles.guard";
import { requireJwtSecrets } from "./identity/jwt-secrets";
import { shouldSkipThrottle } from "./http-setup";

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
      skipIf: () => shouldSkipThrottle(),
    }),
    PrismaModule,
    TenancyModule,
    IdentityModule,
    CatalogModule,
    BusinessModule,
    SalesModule,
    CashModule,
    StatsModule,
    CustomerAccessModule,
  ],
  controllers: [HealthController, DiagController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: PagingHeadersInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: BusinessGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
