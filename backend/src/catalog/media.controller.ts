import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { MediaService } from "./media.service";
import {
  PatchProductImageDto,
  RegisterProductImageDto,
  ReorderProductImagesDto,
} from "./media.dto";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { resolveIdempotencyKey } from "../shared/idempotency";

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("products/:id/image-signature")
  signUpload(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
  ) {
    return this.media.signUpload(ctx, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post("products/:id/images")
  registerImage(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: RegisterProductImageDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.media.registerImage(
      ctx,
      id,
      { ...dto, requestId: resolveIdempotencyKey(key, dto.requestId) },
    );
  }

  @Get("products/:id/images")
  listImages(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
  ) {
    return this.media.listImages(ctx, id);
  }

  @Patch("products/:id/images/reorder")
  reorderImages(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Body() dto: ReorderProductImagesDto,
  ) {
    return this.media.reorderImages(ctx, id, dto.imageIds);
  }

  @Patch("products/:id/images/:imageId")
  patchImage(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Param("imageId") imageId: string,
    @Body() dto: PatchProductImageDto,
  ) {
    return this.media.patchImage(ctx, id, imageId, dto);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Delete("products/:id/images/:imageId")
  removeImage(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id") id: string,
    @Param("imageId") imageId: string,
  ) {
    return this.media.removeImage(ctx, id, imageId);
  }
}
