import { IsOptional, IsString, IsUUID, Matches, MinLength } from "class-validator";

export class CustomerLoginDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;

  @IsOptional()
  @IsUUID()
  businessId?: string;
}

export class CustomerRefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class CustomerLogoutDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
