import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";

export class OpenSessionDto {
  @IsInt()
  @Min(0)
  openingFloat!: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class CloseSessionDto {
  @IsInt()
  @Min(0)
  countedEfectivo!: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class CashOwnerMoveDto {
  @IsInt()
  @Min(1)
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
