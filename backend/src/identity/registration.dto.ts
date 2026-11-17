import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const STATUSES = [
  "PENDING_EMAIL_VERIFICATION",
  "PENDING_ADMIN_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
] as const;

export class SubmitRegistrationDto {
  @IsString()
  @MinLength(2, { message: "Escribe tu nombre." })
  @MaxLength(80, { message: "El nombre es demasiado largo." })
  name!: string;

  @IsEmail({}, { message: "Escribe un correo válido." })
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(8, { message: "La contraseña debe tener al menos 8 caracteres." })
  @MaxLength(72, { message: "La contraseña es demasiado larga." })
  password!: string;

  @IsString()
  @MinLength(8, { message: "Confirma la contraseña (mínimo 8 caracteres)." })
  @MaxLength(72)
  confirmPassword!: string;

  /** Honeypot. Humans leave it empty. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyWebsite?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;
}

export class VerifyRegistrationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}

export class ResendRegistrationDto {
  @IsEmail({}, { message: "Escribe un correo válido." })
  @MaxLength(200)
  email!: string;
}

export class RejectRegistrationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "La nota es demasiado larga." })
  note?: string;
}

export class ListRegistrationsDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
