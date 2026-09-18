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
  ValidateNested,
} from "class-validator";

export class SaleLineDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
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
  amount!: number;

  @IsEnum(["Efectivo", "Nequi"])
  method!: "Efectivo" | "Nequi";

  @IsOptional()
  @IsUUID()
  requestId?: string;
}
