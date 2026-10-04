import { Module } from "@nestjs/common";
import { AuthSessionService } from "./auth-sessions";
import { IdentityController } from "./identity.controller";
import { IdentityService } from "./identity.service";

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, AuthSessionService],
  exports: [IdentityService],
})
export class IdentityModule {}
