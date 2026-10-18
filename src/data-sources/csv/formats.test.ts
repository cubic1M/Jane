import { describe, expect, it } from "vitest";
import { chaseCreditCard, detectFormat, parseUsDate } from "./formats";

describe("parseUsDate", () => {
  it("converts MM/DD/YYYY to an ISO date", () => {
    expect(parseUsDate("10/03/2026")).toBe("2026-10-03");
    expect(parseUsDate("1/3/2026")).toBe("2026-01-03");
  });

  it("rejects impossible or differently formatted dates", () => {
    expect(parseUsDate("02/30/2026")).toBeNull();
    expect(parseUsDate("13/01/2026")).toBeNull();
    expect(parseUsDate("2026-10-03")).toBeNull();
    expect(parseUsDate("")).toBeNull();
  });
});

describe("detectFormat", () => {
  it("recognizes Chase headers regardless of case and spacing", () => {
    expect(
      detectFormat([
        " details",
        "POSTING DATE",
        "Description",
        "Amount",
        "Type",
        "Balance",
        "Check or Slip #",
      ])?.id,
    ).toBe("chase_checking");
    expect(
      detectFormat(["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount"])
        ?.id,
    ).toBe("chase_credit_card");
  });

  it("returns null for unknown headers", () => {
    expect(detectFormat(["Date", "Payee", "Debit", "Credit"])).toBeNull();
  });
});

describe("chaseCreditCard.parseRow", () => {
  const row = (values: Record<string, string>) => (header: string) => values[header] ?? "";

  it("requires a description", () => {
    expect(
      chaseCreditCard.parseRow(
        row({ "post date": "10/01/2026", amount: "-1.00", description: " " }),
      ),
    ).toEqual({ ok: false, reason: "Missing description" });
  });
});
