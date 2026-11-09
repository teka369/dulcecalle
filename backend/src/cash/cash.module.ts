import { Module } from "@nestjs/common";
import { CashController } from "./cash.controller";
import { CashService } from "./cash.service";
import { CashManagerService } from "./cash-manager.service";
import { DebtController } from "./debt.controller";
import { DebtService } from "./debt.service";

@Module({
  controllers: [CashController, DebtController],
  providers: [CashService, CashManagerService, DebtService],
  exports: [CashService, CashManagerService, DebtService],
})
export class CashModule {}
