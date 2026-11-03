import { describe, expect, it } from "vitest";
import {
  STATEMENT_ASK_AFTER_UPLOAD_DAYS,
  STATEMENT_ASK_GRACE_DAYS,
  STATEMENT_ASK_MAX_CYCLES,
  STATEMENT_CYCLE_DAYS,
} from "@/config/import";
import { addDays } from "@/lib/dates";
import { askDay, freshnessOf, oldDataLine, reachWords, statementAsk } from "./freshness";

const ends = "2026-09-30";
const dueOn = addDays(ends, STATEMENT_CYCLE_DAYS + STATEMENT_ASK_GRACE_DAYS);
const one = (asOf: string, hasBank = false) =>
  freshnessOf([{ id: "a", name: "Chase Checking", coveredThrough: ends }], { hasBank, asOf });

describe("freshnessOf", () => {
  it("is due when the cycle has ended and the bank has had time to post", () => {
    expect(one(addDays(dueOn, -1)).due).toEqual([]);
    expect(one(dueOn).due.map((a) => a.id)).toEqual(["a"]);
  });

  it("leaves out an account with nothing uploaded, and knows a bank link when it sees one", () => {
    const f = freshnessOf([{ id: "a", name: "A", coveredThrough: null }], {
      hasBank: false,
      asOf: dueOn,
    });
    expect(f.uploaded).toEqual([]);
    expect(f.uploadOnly).toBe(false);
    expect(one(dueOn, true).uploadOnly).toBe(false);
    expect(one(dueOn).uploadOnly).toBe(true);
  });
});

describe("statementAsk", () => {
  it("is nothing until a cycle has ended", () => {
    expect(statementAsk(one(addDays(dueOn, -1)), addDays(dueOn, -1))).toBeNull();
  });

  it("names the account and the day, with one key a cycle", () => {
    const ask = statementAsk(one(dueOn), dueOn)!;
    expect(ask.title).toBe("A new statement for Chase Checking should be ready");
    expect(ask.body).toContain("Sep 30");
    expect(askDay(ask.key)).toBe(ends);
    expect(statementAsk(one(addDays(dueOn, 10)), addDays(dueOn, 10))!.key).toBe(ask.key);
    expect(
      statementAsk(one(addDays(dueOn, STATEMENT_CYCLE_DAYS)), addDays(dueOn, STATEMENT_CYCLE_DAYS))!
        .key,
    ).not.toBe(ask.key);
  });

  it("waits a while after an upload, even of an old file, though the run says it's old", () => {
    const file = (uploadedOn: string) =>
      freshnessOf([{ id: "a", name: "Chase", coveredThrough: ends, uploadedOn }], {
        hasBank: false,
        asOf: dueOn,
      });
    const justNow = file(addDays(dueOn, 1 - STATEMENT_ASK_AFTER_UPLOAD_DAYS));
    expect(statementAsk(justNow, dueOn)).toBeNull();
    expect(oldDataLine(justNow)).toContain("only had old data");
    expect(
      statementAsk(file(addDays(dueOn, -STATEMENT_ASK_AFTER_UPLOAD_DAYS)), dueOn),
    ).not.toBeNull();
  });

  it("stops asking someone who stopped uploading", () => {
    const later = addDays(
      ends,
      (STATEMENT_ASK_MAX_CYCLES + 1) * STATEMENT_CYCLE_DAYS + STATEMENT_ASK_GRACE_DAYS,
    );
    expect(statementAsk(one(later), later)).toBeNull();
    // The run keeps saying the data is old.
    expect(oldDataLine(one(later))).toContain("only had old data");
  });

  it("names every account that's behind in one ask", () => {
    const f = freshnessOf(
      [
        { id: "a", name: "Chase", coveredThrough: ends },
        { id: "b", name: "Amex", coveredThrough: "2026-09-20" },
        { id: "c", name: "Citi", coveredThrough: dueOn },
      ],
      { hasBank: false, asOf: dueOn },
    );
    const ask = statementAsk(f, dueOn)!;
    expect(ask.title).toBe("New statements for Amex and Chase should be ready");
    expect(askDay(ask.key)).toBe(ends);
  });
});

describe("what the nightly run says", () => {
  it("says plainly when it only had old data, and nothing when it's current", () => {
    expect(oldDataLine(one(dueOn))).toBe(
      "I only had old data to check: your newest statement ends Sep 30. Upload a newer one and I'll check it.",
    );
    expect(oldDataLine(one(addDays(dueOn, -1)))).toBeNull();
  });

  it("says which account when only some are behind", () => {
    const f = freshnessOf(
      [
        { id: "a", name: "Chase", coveredThrough: ends },
        { id: "b", name: "Amex", coveredThrough: dueOn },
      ],
      { hasBank: false, asOf: dueOn },
    );
    expect(oldDataLine(f)).toBe("Chase only reaches Sep 30, so I couldn't check it past then.");
  });

  it("says how far the statements reach on a line that would sound complete", () => {
    expect(reachWords(one(addDays(dueOn, -1)))).toBe("as far as your statements reach (Sep 30)");
    expect(reachWords(one(dueOn, true))).toBeNull();
  });
});
