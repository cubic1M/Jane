import { describe, expect, it } from "vitest";
import { STALE_UPLOAD_DAYS } from "@/config/import";
import { addDays } from "@/detection/units";
import { DATED } from "./reasons";

// Gate C (debug 3, 11-19): on the day a person's statements become too old to say what's now,
// the cushion card waits and the chat's net worth says when it's from; a return's due date counts
// down every day. Each reason names only those.

const reason = (name: string) => DATED.find((r) => r.name === name)!;
const person = { linked: "2027-01-28", lastLine: "2027-01-24" };

describe("statements too old to say what's now", () => {
  const old = reason("statements too old to say what's now");

  it("explains the cushion card and the chat's net worth on that one day", () => {
    const day = addDays(person.lastLine, STALE_UPLOAD_DAYS + 1);
    expect(day).toBe("2027-03-11");
    expect(old.paths.test("suggestions.safe_to_spend:emergency_fund.short")).toBe(true);
    expect(old.paths.test("chat.what's my net worth.body")).toBe(true);
    expect(old.on!(day, person)).toBe(true);
    expect(old.on!(addDays(day, -1), person)).toBe(false);
    expect(old.on!(addDays(day, 1), person)).toBe(false);
  });

  it("explains nothing else", () => {
    expect(old.paths.test("suggestions.insurance:car_cover_cost.short")).toBe(false);
    expect(old.paths.test("chat.what's safe to spend.body")).toBe(false);
  });
});

describe("the return's countdown", () => {
  it("is the filing-extension card's why only", () => {
    const countdown = reason("the return's countdown");
    expect(countdown.paths.test("suggestions.taxes:filing_extension.why")).toBe(true);
    expect(countdown.paths.test("suggestions.taxes:filing_extension.short")).toBe(false);
  });
});
