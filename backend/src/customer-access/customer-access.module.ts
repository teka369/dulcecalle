import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { ReceiptsModule } from "../receipts/receipts.module";
import { PortalReceiptsController } from "./portal-receipts.controller";
import { AuthSessionService } from "../identity/auth-sessions";
import { CustomerAccessController } from "./customer-access.controller";
import { CustomerAccessService } from "./customer-access.service";
import { CustomerJwtGuard } from "./customer.guard";
import { PortalLoginThrottle } from "./portal-throttle";

@Module({
  imports: [CatalogModule, ReceiptsModule],
  controllers: [CustomerAccessController, PortalReceiptsController],
  providers: [
    CustomerAccessService,
    CustomerJwtGuard,
    AuthSessionService,
    PortalLoginThrottle,
  ],
})
export class CustomerAccessModule {}
