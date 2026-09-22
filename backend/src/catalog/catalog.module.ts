import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";

@Module({
  controllers: [CatalogController, MediaController],
  providers: [CatalogService, MediaService],
  exports: [CatalogService, MediaService],
})
export class CatalogModule {}
