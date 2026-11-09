import { IsEnum, IsInt, IsObject, IsOptional, IsUUID, Max, Min } from "class-validator";
import { MAX_COP_AMOUNT, MAX_COP_MESSAGE } from "../shared/money";

/** C04 R5 — POST customers/:id/credit/apply. */
export class ApplyCreditDto {
  /** {mode:"fifo"} (default) | {mode:"sale", saleId} | {mode:"split", targets}. */
  @IsOptional()
  @IsObject()
  target?: Record<string, unknown>;

  /** Omitted → as much as possible (min(saldo a favor, deuda)). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  amount?: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

/** C04 R5b — POST customers/:id/credit/refund (owner). */
export class RefundCreditDto {
  @IsInt()
  @Min(1)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  amount!: number;

  @IsEnum(["Efectivo", "Nequi"])
  method!: "Efectivo" | "Nequi";

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

