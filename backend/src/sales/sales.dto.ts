import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  ValidateNested,
} from "class-validator";
import { MAX_COP_AMOUNT, MAX_COP_MESSAGE } from "../shared/money";

export class SaleLineDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  unitPrice?: number;
}

export class CreateSaleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines!: SaleLineDto[];

  @IsEnum(["paid", "partial", "credit"])
  paymentKind!: "paid" | "partial" | "credit";

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsInt()
  @Min(0)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  amountReceived!: number;

  @IsOptional()
  @IsEnum(["Efectivo", "Nequi"])
  method?: "Efectivo" | "Nequi";

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  /** C03 — when the sale happened (ISO 8601, device clock). */
  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  /**
   * C04 R5 — explicit one-tap confirmation to use the customer's saldo a
   * favor in this same sale. Never applied without it. The offline outbox
   * never sends it (J3 / T34).
   */
  @IsOptional()
  @IsBoolean()
  applyCredit?: boolean;
}

export class CreatePaymentDto {
  @IsInt()
  @Min(1)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  amount!: number;

  @IsEnum(["Efectivo", "Nequi"])
  method!: "Efectivo" | "Nequi";

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  /** C01/C03 — when the money was received (ISO 8601, device clock). */
  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  /**
   * C04 §6.1 — {mode:"fifo"} (default) | {mode:"sale", saleId?, saleRequestId?}
   * | {mode:"split", targets:[{saleId|initialDebtId, amount}]}. Shape is
   * checked by parseTarget (400 VALIDATION when malformed).
   */
  @IsOptional()
  @IsObject()
  target?: Record<string, unknown>;

  /** C04 R2/R3 — what to do with the rest: "fifo" (default) or "credit". */
  @IsOptional()
  @IsIn(["fifo", "credit"])
  overflow?: "fifo" | "credit";
}

export class ReturnLineDto {
  @IsUUID()
  saleLineId!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

export class CreateReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  /** C04 decision 6 — how to settle the rest (value − debtReduced). */
  @IsOptional()
  @IsIn(["refund", "credit"])
  remainder?: "refund" | "credit";
}
