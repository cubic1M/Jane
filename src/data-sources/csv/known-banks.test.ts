import { describe, expect, it } from "vitest";
import { KNOWN_BANKS_LINE } from "@/config/import";
import { CSV_FORMATS, HEADERLESS_FORMATS } from "./formats";

// How /import names a layout's bank, where it differs from the layout's own name.
const SAID: Record<string, string> = { Apple: "Apple Card", "US Bank": "U.S. Bank" };

describe("the banks /import says Jane knows", () => {
  it("name every bank whose layout Jane reads", () => {
    for (const format of [...CSV_FORMATS, ...HEADERLESS_FORMATS]) {
      const bank = format.bank;
      if (!bank) continue;
      expect(KNOWN_BANKS_LINE, format.id).toContain(SAID[bank] ?? bank);
    }
  });
});
