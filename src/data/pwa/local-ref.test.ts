import { describe, expect, it } from "vitest";
import { localRef } from "./local-ref";

describe("localRef (C01)", () => {
  it("formats L-AAMMDD-XXXX from device time and the id tail", () => {
    const at = new Date(2026, 10, 3, 9, 30).getTime();
    expect(localRef("3f2a-9c1b-77ad", at)).toBe("L-261103-77AD");
  });
  it("pads short ids", () => {
    expect(localRef("a1", new Date(2026, 0, 5).getTime())).toBe("L-260105-00A1");
  });
});
