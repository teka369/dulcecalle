import { Module } from "@nestjs/common";
import { BusinessDataController } from "./business-data.controller";
import { BusinessDataService } from "./business-data.service";

@Module({
  controllers: [BusinessDataController],
  providers: [BusinessDataService],
})
export class BusinessModule {}
