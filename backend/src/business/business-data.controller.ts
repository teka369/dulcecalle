import { Controller, Delete } from "@nestjs/common";
import { BusinessDataService } from "./business-data.service";
import { CurrentBusiness } from "../tenancy/business.decorator";
import { Roles } from "../shared/http/decorators";
import type { BusinessContext } from "../identity/auth.types";

@Controller()
export class BusinessDataController {
  constructor(private readonly data: BusinessDataService) {}

  /**
   * Owner-only destructive reset of the current business' operational
   * data. The business itself, users and memberships are never touched.
   * The business comes from the session (BusinessGuard), never from the
   * client, so one tenant cannot wipe another.
   */
  @Roles("owner")
  @Delete("business/data")
  resetData(@CurrentBusiness() ctx: BusinessContext) {
    return this.data.resetData(ctx);
  }
}
