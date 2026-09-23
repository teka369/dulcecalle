import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MediaService } from "../catalog/media.service";
import type { BusinessContext } from "../identity/auth.types";

/**
 * Destructive business data reset. Deletes every business-scoped
 * operational row of the current business inside one transaction.
 * Never touches users, memberships, the business itself, or other tenants.
 * The schema has no ON DELETE cascades, so children are removed first in
 * FK-safe order (productImages before products: the FK is RESTRICT to
 * protect history, and the reset honors it instead of weakening it).
 * Re-running on an empty business is a harmless no-op.
 *
 * Cloudinary is NOT part of the DB transaction (no distributed
 * transactions): after a successful commit, assets are destroyed
 * best-effort. A failed destroy leaves an inert orphan (no DB row
 * references it), never a broken product, and never fails the reset.
 */
@Injectable()
export class BusinessDataService {
  private readonly log = new Logger("BusinessData");

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async resetData(ctx: BusinessContext): Promise<{
    deleted: Record<string, number>;
    deletedCustomerIds: string[];
    cloudinary: { destroyed: number; failed: number };
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
      // Collect asset ids BEFORE deleting: post-commit Cloudinary cleanup
      // needs them and the rows will be gone. FK-safe order: images first.
      const images = await tx.productImage.findMany({
        where: { businessId: ctx.businessId },
        select: { publicId: true },
      });
      await wipe(tx, "productImages", (where) => tx.productImage.deleteMany({ where }));
      await wipe(tx, "products", (where) => tx.product.deleteMany({ where }));
      await wipe(tx, "settings", (where) => tx.setting.deleteMany({ where }));
      await wipe(tx, "importIdMap", (where) => tx.importIdMap.deleteMany({ where }));
      return {
        customerIds: customers.map((c) => c.id),
        publicIds: images.map((i) => i.publicId),
      };
    });

    let cloudinary = { destroyed: 0, failed: 0 };
    if (doomed.publicIds.length > 0) {
      try {
        cloudinary = await this.media.destroyAssets(ctx.businessId, doomed.publicIds);
      } catch (e) {
        this.log.warn(
          `reset cloudinary cleanup failed: business=${ctx.businessId} assets=${doomed.publicIds.length} error=${e instanceof Error ? e.message : "unknown"}`,
        );
      }
      if (cloudinary.failed > 0) {
        this.log.warn(
          `reset cloudinary orphans: business=${ctx.businessId} destroyed=${cloudinary.destroyed} failed=${cloudinary.failed}`,
        );
      }
    }

    return { deleted, deletedCustomerIds: doomed.customerIds, cloudinary };
  }
}
