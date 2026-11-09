import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { MAX_COP_AMOUNT, MAX_COP_MESSAGE } from "../shared/money";

/** C07 / decision 10 — closed list (T25: anything else → 400). */
export const REVERSAL_REASONS = [
  "error_digitacion",
  "cliente_equivocado",
  "monto_equivocado",
  "duplicado",
  "devolucion",
  "otro",
] as const;
export type ReversalReasonCode = (typeof REVERSAL_REASONS)[number];

/** POST sales/:id/void and POST customers/:id/payments/:paymentId/reverse. */
export class ReverseDto {
  @IsEnum(REVERSAL_REASONS)
  reasonCode!: ReversalReasonCode;

  /** Mandatory only with `otro` (decision 14), 5–280 chars (checked by the service). */
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reasonText?: string;

  /** G4b — original older than 30 days: second confirmation. */
  @IsOptional()
  @IsBoolean()
  confirmOld?: boolean;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  /** §5.3b — «Deshacer» shortcut from the success sheet (audit only). */
  @IsOptional()
  @IsIn(["undo", "manual"])
  source?: "undo" | "manual";
}

/** §5.3 — the new abono of «corregir abono» (decision 21: NEW requestId). */
export class ReplacementPaymentDto {
  @IsUUID()
  customerId!: string;

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
  @IsObject()
  target?: Record<string, unknown>;

  @IsOptional()
  @IsIn(["fifo", "credit"])
  overflow?: "fifo" | "credit";

  @IsUUID()
  requestId!: string;
}

export class CorrectPaymentDto extends ReverseDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ReplacementPaymentDto)
  replacement!: ReplacementPaymentDto;
}
