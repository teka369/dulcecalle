import { Module } from "@nestjs/common";
import { ReceiptLinkRevokeController, ReceiptLinksController } from "./receipt-links.controller";
import { ReceiptLinksService } from "./receipt-links.service";
import { ReceiptVerifyController } from "./receipt-verify.controller";
import { ReceiptsController } from "./receipts.controller";
import { ReceiptsService } from "./receipts.service";

@Module({
  // ReceiptVerifyController first: its literal `verify/:code` never meets `:id` (one segment), order kept explicit anyway.
  controllers: [ReceiptVerifyController, ReceiptsController, ReceiptLinksController, ReceiptLinkRevokeController],
  providers: [ReceiptsService, ReceiptLinksService],
  exports: [ReceiptsService, ReceiptLinksService],
})
export class ReceiptsModule {}
