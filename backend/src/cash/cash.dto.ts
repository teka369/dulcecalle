import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from "class-validator";
import { MAX_COP_AMOUNT, MAX_COP_MESSAGE } from "../shared/money";

export class OpenSessionDto {
  @IsInt()
  @Min(0)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  openingFloat!: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class CloseSessionDto {
  @IsInt()
  @Min(0)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  countedEfectivo!: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class CashOwnerMoveDto {
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
}

export class CreateExpenseDto {
  @IsInt()
  @Min(1)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  amount!: number;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsEnum(["Efectivo", "Nequi"])
  method!: "Efectivo" | "Nequi";

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class CarrySessionDto {
  @IsEnum(["counted", "assumed"])
  mode!: "counted" | "assumed";

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  countedEfectivo?: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class AssignMoveDto {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}
