import { Module } from "@nestjs/common";
import { ReceiptLinkRevokeController, ReceiptLinksController } from "./receipt-links.controller";
import { ReceiptLinksService } from "./receipt-links.service";
import { ReceiptsController } from "./receipts.controller";
import { ReceiptsService } from "./receipts.service";

@Module({
  controllers: [ReceiptsController, ReceiptLinksController, ReceiptLinkRevokeController],
  providers: [ReceiptsService, ReceiptLinksService],
  exports: [ReceiptsService, ReceiptLinksService],
})
export class ReceiptsModule {}
