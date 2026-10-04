import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { AuthSessionService } from "../identity/auth-sessions";
import { CustomerAccessController } from "./customer-access.controller";
import { CustomerAccessService } from "./customer-access.service";
import { CustomerJwtGuard } from "./customer.guard";
import { PortalLoginThrottle } from "./portal-throttle";

@Module({
  imports: [CatalogModule],
  controllers: [CustomerAccessController],
  providers: [
    CustomerAccessService,
    CustomerJwtGuard,
    AuthSessionService,
    PortalLoginThrottle,
  ],
})
export class CustomerAccessModule {}
