import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { MediaController } from "./media.controller";
import { CLOUDINARY_FETCH, MediaService } from "./media.service";

@Module({
  controllers: [CatalogController, MediaController],
  providers: [
    CatalogService,
    MediaService,
    { provide: CLOUDINARY_FETCH, useValue: fetch },
  ],
  exports: [CatalogService, MediaService],
})
export class CatalogModule {}
