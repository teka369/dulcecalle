import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_BUSINESS = "skipBusiness";
export const SkipBusiness = () => SetMetadata(SKIP_BUSINESS, true);

export const ROLES_KEY = "roles";
export const Roles = (...roles: Array<"owner" | "staff">) =>
  SetMetadata(ROLES_KEY, roles);
