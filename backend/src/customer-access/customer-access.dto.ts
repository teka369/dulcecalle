import { IsString, MinLength } from "class-validator";

export class CustomerLoginDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}

export class CustomerRefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
