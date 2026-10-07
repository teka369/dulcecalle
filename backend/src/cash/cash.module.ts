import { Module } from "@nestjs/common";
import { CashController } from "./cash.controller";
import { CashService } from "./cash.service";
import { CashManagerService } from "./cash-manager.service";

@Module({
  controllers: [CashController],
  providers: [CashService, CashManagerService],
  exports: [CashService, CashManagerService],
})
export class CashModule {}
