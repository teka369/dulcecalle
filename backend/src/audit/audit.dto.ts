import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { MAX_COP_AMOUNT, MAX_COP_MESSAGE } from "../shared/money";

export const CLIENT_EVENT_KINDS = ["rejected", "discarded", "replaced"] as const;
export type ClientEventKind = (typeof CLIENT_EVENT_KINDS)[number];

export class ClientOpEventDto {
  @IsUUID()
  operationId!: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsString()
  @MaxLength(40)
  entity!: string;

  @IsString()
  @MaxLength(40)
  operation!: string;

  @IsIn(CLIENT_EVENT_KINDS)
  kind!: ClientEventKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COP_AMOUNT, { message: MAX_COP_MESSAGE })
  amount?: number;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  rejectionCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lastError?: string;

  @IsOptional()
  @IsUUID()
  replacedBy?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  deviceCreatedAt?: string;
}
