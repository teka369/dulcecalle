import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from "class-validator";

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  avgCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockAt?: number;

  @IsOptional()
  @IsBoolean()
  gifted?: boolean;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class PatchProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockAt?: number;

  /** Detected so we can return STOCK_VIA_MOVES instead of a generic 400. */
  @IsOptional()
  stock?: unknown;

  @IsOptional()
  avgCost?: unknown;
}

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}


export class CreateCustomerPaymentDto {
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

export class PatchCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** Detected so we can reject hand-edited debt. */
  @IsOptional()
  debt?: unknown;
}

export class CreateInitialDebtDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class SurtirDto {
  @IsInt()
  @Min(1)
  qty!: number;

  @IsInt()
  @Min(0)
  unitCost!: number;

  @IsInt()
  @Min(0)
  totalCost!: number;

  @IsEnum(["Efectivo", "Nequi"])
  method!: "Efectivo" | "Nequi";

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class ShrinkDto {
  @IsInt()
  @Min(1)
  qty!: number;

  @IsEnum(["me_lo_comi", "regalar", "perdido"])
  reason!: "me_lo_comi" | "regalar" | "perdido";

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class PatchSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
