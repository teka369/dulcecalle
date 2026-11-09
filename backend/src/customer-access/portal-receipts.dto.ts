import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** C09 §7 — `POST customer/me/receipts/:id/ack`. */
export class ReceiptAckDto {
  @IsIn(["acknowledged", "reported_issue"])
  kind!: "acknowledged" | "reported_issue";

  /** The hash of the version the customer saw (T15). */
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  receiptHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
