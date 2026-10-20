import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
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
}
