import { IsInt, Min } from "class-validator";

export class OpenSessionDto {
  @IsInt()
  @Min(0)
  openingFloat!: number;
}

export class CloseSessionDto {
  @IsInt()
  @Min(0)
  countedEfectivo!: number;
}
