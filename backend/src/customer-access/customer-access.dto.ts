import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

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

  /** Store short name or 8-char store code; only used when the code is in 2+ stores. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  store?: string;
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
