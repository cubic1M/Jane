import { describe, expect, it } from "vitest";
import { BILLERS } from "@/config/billers";
import { autopayCovers, billerFor, findSettlement, payOnFor, type BankLine } from "./rules";

const line = (over: Partial<BankLine>): BankLine => ({
  id: crypto.randomUUID(),
  date: "2026-11-10",
  amountCents: 8412,
  description: "ONLINE PAYMENT",
  merchantName: null,
  accountId: "checking",
  ...over,
});

describe("the billers table", () => {
  it("has a source for every row and pay pages only at https", () => {
    expect(BILLERS).toHaveLength(47);
    for (const row of BILLERS) {
      expect(row.sources.length, row.biller).toBeGreaterThan(0);
      if (row.payUrl) expect(row.payUrl, row.biller).toMatch(/^https:\/\/\S+$/);
      expect(row.matchTokens.length, row.biller).toBeGreaterThan(0);
      expect(row.settleBusinessDays, row.biller).toBeGreaterThanOrEqual(1);
    }
  });

  it("marks autopay as on by default for buy now, pay later only", () => {
    expect(BILLERS.filter((b) => b.autopayByDefault).map((b) => b.type)).toEqual([
      "bnpl",
      "bnpl",
      "bnpl",
    ]);
  });
});

describe("billerFor", () => {
  it("finds the biller by name, the longest match first", () => {
    expect(billerFor("Con Edison")?.biller).toBe("Con Edison");
    expect(billerFor("Chase Home Lending")?.biller).toBe("Chase Home Lending");
    expect(billerFor("Chase")?.biller).toBe("Chase (credit cards)");
    expect(billerFor("Some Local Water Co")).toBeNull();
  });
});

describe("payOnFor", () => {
  it("pays three business days before it's due, five through bank bill pay", () => {
    // Due Friday 2026-11-20.
    expect(payOnFor("2026-11-20", { today: "2026-11-06" })).toBe("2026-11-17");
    expect(payOnFor("2026-11-20", { today: "2026-11-06", viaBankBillPay: true })).toBe(
      "2026-11-13",
    );
    // Due Monday: three business days back skips the weekend.
    expect(payOnFor("2026-11-23", { today: "2026-11-06" })).toBe("2026-11-18");
  });

  it("never picks a day before today", () => {
    expect(payOnFor("2026-11-09", { today: "2026-11-06" })).toBe("2026-11-06");
  });
});

describe("autopayCovers", () => {
  const chase = BILLERS.find((b) => b.biller === "Chase (credit cards)")!;
  const affirm = BILLERS.find((b) => b.biller === "Affirm")!;
  const today = "2026-11-06";

  it("sees an autopay line from the biller, lately and out of the account", () => {
    const auto = line({ date: "2026-10-20", description: "CHASE CREDIT CRD AUTOPAY 1234" });
    expect(autopayCovers(chase, [auto], { today })).toBe(true);
    expect(autopayCovers(chase, [{ ...auto, amountCents: -8412 }], { today })).toBe(false);
    expect(autopayCovers(chase, [{ ...auto, date: "2026-08-01" }], { today })).toBe(false);
    expect(autopayCovers(chase, [line({ description: "CHASE CREDIT CRD EPAY" })], { today })).toBe(
      false,
    );
    expect(autopayCovers(chase, [line({ description: "VERIZON AUTOPAY" })], { today })).toBe(false);
  });

  it("takes buy now, pay later as on autopay", () => {
    expect(autopayCovers(affirm, [], { today })).toBe(true);
  });
});

describe("findSettlement", () => {
  const conEd = BILLERS.find((b) => b.biller === "Con Edison")!;
  const pge = BILLERS.find((b) => b.biller === "PG&E")!;
  const payment = { biller: conEd, amountCents: 8412, payOn: "2026-11-10", accountId: "checking" };

  it("keys on the exact amount, from the pay day to the window's end", () => {
    expect(findSettlement(payment, [line({ date: "2026-11-10" })])?.confidence).toBe(
      "amount_and_days",
    );
    expect(findSettlement(payment, [line({ amountCents: 8413 })])).toBeNull();
    expect(findSettlement(payment, [line({ date: "2026-11-09" })])).toBeNull();
    expect(findSettlement(payment, [line({ date: "2026-11-20" })])).toBeNull();
    expect(findSettlement(payment, [line({ accountId: "savings" })])).toBeNull();
  });

  it("uses a name only for confidence, and won't guess between two", () => {
    const named = line({ description: "CON EDISON PAYMENT" });
    const other = line({});
    expect(findSettlement(payment, [other, named])).toEqual({
      lineId: named.id,
      confidence: "amount_days_and_name",
    });
    expect(findSettlement(payment, [line({}), line({})])).toBeNull();
    expect(findSettlement(payment, [other], new Set([other.id]))).toBeNull();
  });

  it("allows the biller's documented fee on top", () => {
    const withFee = line({ amountCents: 8412 + pge.feeCents });
    expect(pge.feeCents).toBe(150);
    expect(findSettlement({ ...payment, biller: pge }, [withFee])?.lineId).toBe(withFee.id);
  });
});
