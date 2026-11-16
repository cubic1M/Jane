import { describe, expect, it } from "vitest";
import { monthsOfData, type ProfileTx } from "@/profile/build";
import { dataEnd } from "./helpers";
import { feeMonthsOf } from "./rules/fee-totals";

// Debug 2's desktop walk, 11-16 (gate C): a statement from Jun 1 to Oct 20, uploaded and read on
// Nov 16, counted as reaching today because its last line was under 35 days old. Its five $12
// monthly fees were paced over Jun 1 to Nov 16, "$60.00 in 5 bank fees in 6 months", $120/yr
// (really $144), and the figure fell a little each day until day 35. An upload's history ends
// where its statement closes, a few days after its last line, whatever the gap (as an old one's
// always did), and never past the day it was uploaded; a linked bank's still reaches today.

const LINES = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-10-20"];
// Uploaded on `uploadedOn`; none for a linked bank's lines.
const lines = (uploadedOn?: string) =>
  LINES.map((date) => ({ date, ...(uploadedOn ? { uploadedOn } : {}) }));
// Uploaded on Nov 16 and read then and later: 27, 31 and 35 days after its last line.
const UPLOADED = "2026-11-16";
const DAYS = ["2026-11-16", "2026-11-20", "2026-11-24"];

describe("where an upload's history ends", () => {
  it("is where its statement closes, every day after", () => {
    for (const day of DAYS) expect(dataEnd(lines(UPLOADED), day), day).toBe("2026-10-27");
    // As an old upload's always was.
    expect(dataEnd(lines(UPLOADED), "2027-01-10")).toBe("2026-10-27");
  });

  it("is never past the day it came in, read before its statement closes", () => {
    for (const day of ["2026-10-22", "2026-10-25", "2026-10-30"]) {
      expect(dataEnd(lines("2026-10-22"), day), day).toBe("2026-10-22");
    }
  });

  it("paces its fees over the same months, every day after", () => {
    const months = DAYS.map((asOf) => feeMonthsOf({ transactions: lines(UPLOADED), asOf }));
    expect(months).toEqual([5, 5, 5]);
  });

  it("counts the same months of data, every day after", () => {
    const txs: ProfileTx[] = lines(UPLOADED).map((t) => ({
      ...t,
      amountCents: 1_200,
      description: "MONTHLY SERVICE FEE",
      pfc: "BANK_FEES_OTHER_BANK_FEES",
      accountId: "upload",
    }));
    expect(DAYS.map((day) => monthsOfData(txs, day))).toEqual([5, 5, 5]);
  });

  it("leaves a linked bank reaching today while its newest line is recent", () => {
    expect(dataEnd(lines(), "2026-11-09")).toBe("2026-11-09");
    // A bank linked beside the upload, current: today.
    expect(dataEnd([...lines(UPLOADED), { date: "2026-11-15" }], "2026-11-16")).toBe("2026-11-16");
  });
});
