import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";

export class RegisterProductImageDto {
  @IsUUID()
  requestId!: string;

  @IsString()
  @MaxLength(512)
  publicId!: string;

  @IsUrl({ require_protocol: true })
  @MaxLength(1024)
  secureUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  format?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  bytes?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  altText?: string;
}

export class PatchProductImageDto {
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  altText?: string;
}

export class ReorderProductImagesDto {
  @IsArray()
  @IsUUID("4", { each: true })
  imageIds!: string[];
}
