import { Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentBusiness } from "../tenancy/business.decorator";
import type { BusinessContext } from "../identity/auth.types";
import { UuidParam } from "../shared/http/params";
import { Roles } from "../shared/http/decorators";
import { requireIdempotencyKey } from "../shared/idempotency";
import { ReceiptLinksService } from "./receipt-links.service";

/** C09-PR5 — share a receipt by a one-use 48 h link (SPEC-C09 §5, §7). */
@Roles("owner", "staff")
@Controller("receipts")
export class ReceiptLinksController {
  constructor(private readonly links: ReceiptLinksService) {}

  @Post(":id/links")
  create(
    @CurrentBusiness() ctx: BusinessContext,
    @Param("id", UuidParam) id: string,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.links.create(ctx, id, requireIdempotencyKey(key));
  }
}

/** W6 «Revocar enlace» — owner only. */
@Roles("owner")
@Controller("receipt-links")
export class ReceiptLinkRevokeController {
  constructor(private readonly links: ReceiptLinksService) {}

  @Post(":id/revoke")
  revoke(@CurrentBusiness() ctx: BusinessContext, @Param("id", UuidParam) id: string) {
    return this.links.revoke(ctx, id);
  }
}
