import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { BusinessContext } from "../identity/auth.types";

/**
 * Destructive business data reset. Deletes every business-scoped
 * operational row of the current business inside one transaction.
 * Never touches users, memberships, the business itself, or other tenants.
 * The schema has no ON DELETE cascades, so children are removed first in
 * FK-safe order. Re-running on an empty business is a harmless no-op.
 */
@Injectable()
export class BusinessDataService {
  constructor(private readonly prisma: PrismaService) {}

  async resetData(ctx: BusinessContext): Promise<{
    deleted: Record<string, number>;
    deletedCustomerIds: string[];
  }> {
    const deleted: Record<string, number> = {};
    const wipe = async (
      tx: Prisma.TransactionClient,
      key: string,
      run: (where: { businessId: string }) => Promise<{ count: number }>,
    ): Promise<void> => {
      const result = await run({ businessId: ctx.businessId });
      deleted[key] = result.count;
    };

    const doomed = await this.prisma.$transaction(async (tx) => {
      // Capture portal customer ids first: the frontend needs them to
      // invalidate exactly these ledger snapshots (they carry no businessId).
      const customers = await tx.customer.findMany({
        where: { businessId: ctx.businessId },
        select: { id: true },
      });
      await wipe(tx, "saleReturnLines", (where) => tx.saleReturnLine.deleteMany({ where }));
      await wipe(tx, "saleReturns", (where) => tx.saleReturn.deleteMany({ where }));
      await wipe(tx, "saleLines", (where) => tx.saleLine.deleteMany({ where }));
      await wipe(tx, "sales", (where) => tx.sale.deleteMany({ where }));
      await wipe(tx, "customerPayments", (where) => tx.customerPayment.deleteMany({ where }));
      await wipe(tx, "initialDebts", (where) => tx.initialDebt.deleteMany({ where }));
      await wipe(tx, "stockMoves", (where) => tx.stockMove.deleteMany({ where }));
      await wipe(tx, "cashMoves", (where) => tx.cashMove.deleteMany({ where }));
      await wipe(tx, "cashSessions", (where) => tx.cashSession.deleteMany({ where }));
      await wipe(tx, "expenses", (where) => tx.expense.deleteMany({ where }));
      await wipe(tx, "customers", (where) => tx.customer.deleteMany({ where }));
      await wipe(tx, "suppliers", (where) => tx.supplier.deleteMany({ where }));
      await wipe(tx, "products", (where) => tx.product.deleteMany({ where }));
      await wipe(tx, "settings", (where) => tx.setting.deleteMany({ where }));
      await wipe(tx, "importIdMap", (where) => tx.importIdMap.deleteMany({ where }));
      return customers.map((c) => c.id);
    });

    return { deleted, deletedCustomerIds: doomed };
  }
}
