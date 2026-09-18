/**
 * Artificial development seed. NOT the owner's books.
 * Does not contain the $45.000 initial debts.
 */
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const email = "dev@dulcecalle.test";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("seed already applied");
    return;
  }
  const userId = randomUUID();
  const businessId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      email,
      passwordHash: await bcrypt.hash("devpass12", 12),
    },
  });
  await prisma.business.create({
    data: {
      id: businessId,
      name: "DulceCalle Dev",
      timezone: "America/Bogota",
    },
  });
  await prisma.businessMembership.create({
    data: {
      id: randomUUID(),
      businessId,
      userId,
      role: "owner",
    },
  });
  console.log(`seed user ${email} / devpass12  business ${businessId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
