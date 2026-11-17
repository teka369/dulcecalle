import { Module } from "@nestjs/common";
import { AuthSessionService } from "./auth-sessions";
import { IdentityController } from "./identity.controller";
import { IdentityService } from "./identity.service";
import { MailService } from "./mail.service";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { RegistrationController } from "./registration.controller";
import { RegistrationService } from "./registration.service";

@Module({
  controllers: [IdentityController, RegistrationController],
  providers: [
    IdentityService,
    AuthSessionService,
    RegistrationService,
    MailService,
    PlatformAdminGuard,
  ],
  exports: [IdentityService, RegistrationService, MailService],
})
export class IdentityModule {}
