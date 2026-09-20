import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { CustomerAccessController } from "./customer-access.controller";
import { CustomerAccessService } from "./customer-access.service";
import { CustomerJwtGuard } from "./customer.guard";

@Module({
  imports: [CatalogModule],
  controllers: [CustomerAccessController],
  providers: [CustomerAccessService, CustomerJwtGuard],
})
export class CustomerAccessModule {}
