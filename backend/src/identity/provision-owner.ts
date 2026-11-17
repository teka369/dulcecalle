import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { DEFAULT_TZ } from "../shared/clock";

type Writer = Prisma.TransactionClient;

/** Creates an active owner + business. Does not check registration state. */
export async function createOwnerAccount(
  db: Writer,
  input: { email: string; passwordHash: string; businessName: string },
) {
  const userId = randomUUID();
  const businessId = randomUUID();
  const name = input.businessName.trim() || "Dulce Calle";
  await db.user.create({
    data: { id: userId, email: input.email, passwordHash: input.passwordHash },
  });
  await db.business.create({
    data: { id: businessId, name, timezone: DEFAULT_TZ },
  });
  await db.businessMembership.create({
    data: {
      id: randomUUID(),
      businessId,
      userId,
      role: "owner",
    },
  });
  return { userId, businessId, name, timezone: DEFAULT_TZ };
}
