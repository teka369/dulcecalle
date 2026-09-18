import { Module } from "@nestjs/common";
import { BusinessGuard } from "./business.guard";
import { RolesGuard } from "./roles.guard";

@Module({
  providers: [BusinessGuard, RolesGuard],
  exports: [BusinessGuard, RolesGuard],
})
export class TenancyModule {}
