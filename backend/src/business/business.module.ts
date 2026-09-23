import { Module } from "@nestjs/common";
import { BusinessDataController } from "./business-data.controller";
import { BusinessDataService } from "./business-data.service";
import { CatalogModule } from "../catalog/catalog.module";

@Module({
  imports: [CatalogModule],
  controllers: [BusinessDataController],
  providers: [BusinessDataService],
})
export class BusinessModule {}
