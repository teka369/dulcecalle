import {
  nextAvgCostAfterSurtir,
  openingStoredAvgCost,
  weightedAvgCost,
} from "./inventory";

describe("combo lot pool vs sellable unit average", () => {
  it("sellable surtir keeps the weighted unit average", () => {
    expect(
      nextAvgCostAfterSurtir({
        sellable: true,
        stock: 10,
        avgCost: 100n,
        qty: 5,
        unitCost: 200n,
        totalCost: 1000n,
      }),
    ).toBe(weightedAvgCost(10, 100n, 5, 200n));
  });

  it("combo surtir adds the cash outlay to remaining lot value", () => {
    expect(
      nextAvgCostAfterSurtir({
        sellable: false,
        stock: 1,
        avgCost: 50_000n,
        qty: 1,
        unitCost: 50_000n,
        totalCost: 50_000n,
      }),
    ).toBe(100_000n);
  });

  it("opening combo stock stores unit×qty as the lot pool", () => {
    expect(
      openingStoredAvgCost({ sellable: false, stock: 2, unitCost: 50_000n }),
    ).toBe(100_000n);
    expect(
      openingStoredAvgCost({ sellable: true, stock: 2, unitCost: 50_000n }),
    ).toBe(50_000n);
  });

  it("opening combo with no stock does not store a phantom lot", () => {
    expect(
      openingStoredAvgCost({ sellable: false, stock: 0, unitCost: 0n }),
    ).toBe(0n);
    expect(
      openingStoredAvgCost({ sellable: false, stock: 0, unitCost: 50_000n }),
    ).toBe(0n);
  });
});
