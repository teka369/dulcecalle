import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CashOwnerMoveDto, CloseSessionDto, CreateExpenseDto, OpenSessionDto, CarrySessionDto } from "../cash/cash.dto";
import { CreateCustomerPaymentDto, CreateInitialDebtDto, CreateProductDto } from "../catalog/catalog.dto";
import { CreatePaymentDto } from "../sales/sales.dto";
const MAX_COP_AMOUNT = 100_000_000;

/** loop/v1 T-alto1: every COP field in the write DTOs rejects amounts above MAX_COP_AMOUNT. */
const HUGE = 9007199254740991;
const errorsFor = (cls: new () => object, body: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, body) as object, { whitelist: true }).map((e) => e.property);

describe("MAX_COP_AMOUNT on DTOs", () => {
  it("is a documented ceiling well inside MAX_SAFE_INTEGER", async () => {
    // Imported lazily so the DTO cases below stay red (not a compile error) before the fix.
    const money = (await import("./money")) as { MAX_COP_AMOUNT?: number };
    expect(money.MAX_COP_AMOUNT).toBe(MAX_COP_AMOUNT);
    expect(Number.isSafeInteger(MAX_COP_AMOUNT * 1000)).toBe(true);
  });

  const cases: Array<[string, new () => object, Record<string, unknown>, string]> = [
    ["aporte/retiro", CashOwnerMoveDto, { method: "Efectivo" }, "amount"],
    ["gasto", CreateExpenseDto, { method: "Efectivo", category: "x" }, "amount"],
    ["abrir caja", OpenSessionDto, {}, "openingFloat"],
    ["cerrar caja", CloseSessionDto, {}, "countedEfectivo"],
    ["pasar saldo", CarrySessionDto, { mode: "counted" }, "countedEfectivo"],
    ["abono", CreateCustomerPaymentDto, { method: "Efectivo" }, "amount"],
    ["deuda inicial", CreateInitialDebtDto, {}, "amount"],
    ["pago venta", CreatePaymentDto, { method: "Efectivo" }, "amount"],
    ["precio producto", CreateProductDto, { name: "x", category: "y" }, "price"],
  ];
  it.each(cases)("%s rejects %p above the ceiling and accepts the ceiling", (_n, cls, base, field) => {
    expect(errorsFor(cls, { ...base, [field]: HUGE })).toContain(field);
    expect(errorsFor(cls, { ...base, [field]: MAX_COP_AMOUNT + 1 })).toContain(field);
    expect(errorsFor(cls, { ...base, [field]: MAX_COP_AMOUNT })).not.toContain(field);
  });
});
