import type { INestApplication } from "@nestjs/common";
import { IdentityService } from "../src/identity/identity.service";
import type { HttpSession } from "../../src/data/http/session";

/** Seed an owner without the public /auth/register route. */
export function seedOwner(
  app: INestApplication,
  email: string,
  businessName: string,
  password = "password12",
) {
  return app.get(IdentityService).register({
    email,
    password,
    businessName,
  });
}

export function applyOwnerSession(
  session: HttpSession,
  seeded: Awaited<ReturnType<typeof seedOwner>>,
) {
  session.accessToken = seeded.accessToken;
  session.refreshToken = seeded.refreshToken;
  session.user = seeded.user;
  session.selectBusiness(seeded.business.id);
}
