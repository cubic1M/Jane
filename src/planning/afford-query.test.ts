import { describe, expect, it } from "vitest";
import { AFFORD_COPY } from "./afford-copy";
import { parseAffordQuery } from "./afford-query";

const AS_OF = "2026-10-20";

describe("parseAffordQuery", () => {
  it("shows a blank form, with today and this month, before an amount is entered", () => {
    expect(parseAffordQuery({}, AS_OF)).toEqual({
      form: { kind: "purchase", amount: "", date: AS_OF, month: "2026-10" },
      change: null,
      error: null,
    });
  });

  it("reads a purchase, today by default", () => {
    expect(parseAffordQuery({ kind: "purchase", amount: "1,250.50" }, AS_OF).change).toEqual({
      kind: "purchase",
      amountCents: 125_050,
      date: AS_OF,
    });
    expect(parseAffordQuery({ amount: "300", date: "2027-01-10" }, AS_OF).change).toEqual({
      kind: "purchase",
      amountCents: 30_000,
      date: "2027-01-10",
    });
  });

  it("reads a monthly change as more or less going out", () => {
    expect(
      parseAffordQuery({ kind: "more", amount: "40", month: "2026-12" }, AS_OF).change,
    ).toEqual({ kind: "monthly", amountCents: 4_000, startMonth: "2026-12" });
    expect(parseAffordQuery({ kind: "less", amount: "40" }, AS_OF).change).toEqual({
      kind: "monthly",
      amountCents: -4_000,
      startMonth: "2026-10",
    });
  });

  it("treats an unknown kind as a purchase", () => {
    expect(parseAffordQuery({ kind: "loan", amount: "5" }, AS_OF).change?.kind).toBe("purchase");
  });

  it("takes the first value when a parameter repeats", () => {
    expect(parseAffordQuery({ amount: ["5", "9"] }, AS_OF).change).toMatchObject({
      amountCents: 500,
    });
  });

  it.each([
    [{ amount: "abc" }, AFFORD_COPY.errors.amount],
    [{ amount: "0" }, AFFORD_COPY.errors.amount],
    [{ amount: "-20" }, AFFORD_COPY.errors.amount],
    [{ amount: "1000000.01" }, AFFORD_COPY.errors.tooBig],
    [{ amount: "5", date: "2026-10-19" }, AFFORD_COPY.errors.date],
    [{ amount: "5", date: "2027-10-01" }, AFFORD_COPY.errors.date],
    [{ amount: "5", date: "2026-13-40" }, AFFORD_COPY.errors.date],
    [{ amount: "5", kind: "more", month: "2026-09" }, AFFORD_COPY.errors.month],
    [{ amount: "5", kind: "less", month: "2027-10" }, AFFORD_COPY.errors.month],
  ])("refuses %o", (params, error) => {
    expect(parseAffordQuery(params, AS_OF)).toMatchObject({ change: null, error });
  });

  it("accepts the last day of the last month shown", () => {
    expect(parseAffordQuery({ amount: "5", date: "2027-09-30" }, AS_OF).error).toBeNull();
    expect(
      parseAffordQuery({ amount: "5", kind: "more", month: "2027-09" }, AS_OF).error,
    ).toBeNull();
  });
});
