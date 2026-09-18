import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  checksumCanonical,
  stableStringify,
} from "./canonical";

describe("snapshot checksum canonicalization", () => {
  it("TEST 1: undefined properties survive JSON stringify/parse with the same checksum", async () => {
    const inMemory = {
      customers: [{ id: 1, name: "Pablo", phone: undefined, debt: 3100 }],
    };
    const before = await checksumCanonical(inMemory);
    const after = await checksumCanonical(
      JSON.parse(JSON.stringify(inMemory)) as unknown,
    );
    expect(Object.prototype.hasOwnProperty.call(inMemory.customers[0], "phone")).toBe(
      true,
    );
    expect(before).toBe(after);
  });

  it("TEST 2: identical content yields the same checksum twice", async () => {
    const value = { products: [{ id: 1, name: "Galleta", stock: 15 }] };
    const a = await checksumCanonical(value);
    const b = await checksumCanonical(value);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("TEST 3: changing a real field changes the checksum", async () => {
    const a = await checksumCanonical({ debt: 45_200 });
    const b = await checksumCanonical({ debt: 45_201 });
    expect(a).not.toBe(b);
  });

  it("TEST 4: object key order does not change the checksum", async () => {
    const a = await checksumCanonical({ b: 2, a: 1 });
    const b = await checksumCanonical({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("TEST 5: array order is data and changes the checksum", async () => {
    const a = await checksumCanonical({ ids: [1, 2, 3] });
    const b = await checksumCanonical({ ids: [3, 2, 1] });
    expect(a).not.toBe(b);
  });

  it("TEST 6: null is kept; undefined object keys are omitted", async () => {
    expect(canonicalize({ a: null })).toEqual({ a: null });
    expect(canonicalize({ a: undefined })).toEqual({});
    expect(await checksumCanonical({ a: null })).not.toBe(
      await checksumCanonical({ a: undefined }),
    );
    expect(canonicalize([undefined, 1])).toEqual([null, 1]);
    expect(await checksumCanonical([null])).toBe(await checksumCanonical([undefined]));
  });

  it("TEST 7: real F6.9 snapshot tables round-trip without altering the file", async () => {
    const snapshotPath = join(
      __dirname,
      "../../attachments/dulcecalle-snapshot-544b330b-e499-40b4-8909-cdcf6745fc64.json",
    );
    const raw = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      snapshotId: string;
      checksum: string;
      tables: { customers: { debt: number }[]; products: { stock: number }[] };
    };
    expect(raw.snapshotId).toBe("544b330b-e499-40b4-8909-cdcf6745fc64");
    const debt = raw.tables.customers.reduce((s, c) => s + c.debt, 0);
    const stock = raw.tables.products.reduce((s, p) => s + p.stock, 0);
    expect(debt).toBe(45_200);
    expect(stock).toBe(74);
    expect(raw.tables.customers).toHaveLength(14);
    expect(raw.tables.products).toHaveLength(7);

    const first = await checksumCanonical(raw.tables);
    const roundTrip = await checksumCanonical(
      JSON.parse(JSON.stringify(raw.tables)) as unknown,
    );
    expect(first).toBe(roundTrip);
    expect(JSON.parse(readFileSync(snapshotPath, "utf8")).checksum).toBe(raw.checksum);
  });
});
