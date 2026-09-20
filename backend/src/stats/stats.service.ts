import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { addCop, copToJson, mulCop, subCop } from "../shared/money";
import { dateKey, occurredOnDate } from "../shared/clock";
import type { BusinessContext } from "../identity/auth.types";

type Period = "hoy" | "semana" | "mes";

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async forPeriod(ctx: BusinessContext, period: Period) {
    const today = occurredOnDate(ctx.timezone);
    const from = this.rangeStart(period, today);
    const to = today;

    const [
      sales,
      payments,
      expenses,
      moves,
      products,
      customers,
      returns,
    ] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          businessId: ctx.businessId,
          occurredOn: { gte: from, lte: to },
        },
        include: { lines: true },
      }),
      this.prisma.customerPayment.findMany({
        where: {
          businessId: ctx.businessId,
          occurredOn: { gte: from, lte: to },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          businessId: ctx.businessId,
          occurredOn: { gte: from, lte: to },
        },
      }),
      this.prisma.cashMove.findMany({
        where: {
          businessId: ctx.businessId,
          occurredOn: { gte: from, lte: to },
        },
      }),
      this.prisma.product.findMany({
        where: { businessId: ctx.businessId, archivedAt: null },
      }),
      this.prisma.customer.findMany({
        where: { businessId: ctx.businessId, archivedAt: null },
      }),
      this.prisma.saleReturn.findMany({
        where: {
          businessId: ctx.businessId,
          occurredOn: { gte: from, lte: to },
        },
        include: { lines: true },
      }),
    ]);

    let ventas = 0n;
    let recibidoSales = 0n;
    let ganancia = 0n;
    for (const s of sales) {
      ventas = addCop(ventas, s.saleTotal);
      recibidoSales = addCop(recibidoSales, s.amountReceived);
      for (const line of s.lines) {
        ganancia = addCop(
          ganancia,
          subCop(line.lineTotal, mulCop(line.unitCost, line.qty)),
        );
      }
    }

    let recibidoAbonos = 0n;
    for (const p of payments) recibidoAbonos = addCop(recibidoAbonos, p.amount);

    let recibidoEfectivo = 0n;
    let recibidoNequi = 0n;
    let inverti = 0n;
    for (const m of moves) {
      if (m.kind === "compra") inverti = addCop(inverti, m.amount);
      if (m.kind !== "sale" && m.kind !== "debt_collect") continue;
      if (m.direction !== "in") continue;
      if (m.method === "Efectivo") recibidoEfectivo = addCop(recibidoEfectivo, m.amount);
      else if (m.method === "Nequi") recibidoNequi = addCop(recibidoNequi, m.amount);
    }

    let porCobrar = 0n;
    for (const c of customers) porCobrar = addCop(porCobrar, c.debt);

    let devoluciones = 0n;
    for (const r of returns) {
      for (const rl of r.lines) {
        devoluciones = addCop(devoluciones, mulCop(rl.unitPrice, rl.qty));
        ganancia = subCop(
          ganancia,
          mulCop(subCop(rl.unitPrice, rl.unitCost), rl.qty),
        );
      }
    }

    let gaste = 0n;
    for (const e of expenses) gaste = addCop(gaste, e.amount);

    let valorInventario = 0n;
    let stockBajo = 0;
    for (const p of products) {
      valorInventario = addCop(valorInventario, mulCop(p.avgCost, p.stock));
      if (p.stock <= p.lowStockAt) stockBajo += 1;
    }

    const emptyPeriod =
      sales.length === 0 &&
      payments.length === 0 &&
      expenses.length === 0 &&
      moves.length === 0 &&
      returns.length === 0;

    return {
      period,
      from: dateKey(from),
      to: dateKey(to),
      ventas: copToJson(ventas),
      ventasCount: sales.length,
      devoluciones: copToJson(devoluciones),
      devolucionesCount: returns.length,
      recibido: copToJson(addCop(recibidoSales, recibidoAbonos)),
      recibidoEfectivo: copToJson(recibidoEfectivo),
      recibidoNequi: copToJson(recibidoNequi),
      porCobrar: copToJson(porCobrar),
      gaste: copToJson(gaste),
      inverti: copToJson(inverti),
      ganancia: copToJson(ganancia),
      valorInventario: copToJson(valorInventario),
      stockBajo,
      emptyPeriod,
    };
  }

  private rangeStart(period: Period, today: Date): Date {
    if (period === "hoy") return today;
    if (period === "semana") {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 6);
      return start;
    }
    const key = dateKey(today);
    return new Date(`${key.slice(0, 7)}-01T00:00:00.000Z`);
  }
}
