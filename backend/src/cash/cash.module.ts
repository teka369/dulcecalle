import { Module } from "@nestjs/common";
import { CashController } from "./cash.controller";
import { CashService } from "./cash.service";
import { CashManagerService } from "./cash-manager.service";
import { DebtController } from "./debt.controller";
import { DebtService } from "./debt.service";
import { ReversalsController } from "./reversals.controller";
import { ReversalsService } from "./reversals.service";

@Module({
  controllers: [CashController, DebtController, ReversalsController],
  providers: [CashService, CashManagerService, DebtService, ReversalsService],
  exports: [CashService, CashManagerService, DebtService],
})
export class CashModule {}
