import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inputFromStatements, suggestionsOf } from "@/detectors/__fixtures__/student-walk";
import type { ProfileInput } from "@/profile/build";

// One statement file says the same whichever day it was uploaded (debug 3, 11-19). Debug 2's
// sweep 7 read the S4 upload's cushion as "$4,971.36" uploaded Nov 18 and "$4,919.01" uploaded
// Nov 19, the same file: its history ended on the day it came in, so a day later was one more
// day of months, and every paced figure moved. Read on one day, every suggestion's words and
// figures are the same for each day it could have been uploaded.

const S4 = "src/lib/jane-agent/checks/__fixtures__/cells/upload-s4-desktop/chase-checking.csv";
const READ = "2026-11-25";
// The newest line is Nov 13: the day after, a few days after, the next week, the day it's read.
const UPLOAD_DAYS = ["2026-11-14", "2026-11-18", "2026-11-19", "2026-11-25"];

const uploadedOn = async (on: string): Promise<ProfileInput> => {
  const data = await inputFromStatements(
    [{ name: "chase-checking.csv", text: readFileSync(S4, "utf8") }],
    READ,
  );
  return {
    ...data,
    transactions: data.transactions.map((t) => ({ ...t, uploadedOn: on })),
    // The file's own balance after its newest line, as the upload reads it.
    accounts: data.accounts.map((a) => ({ ...a, balanceCents: 308_733, balanceKnown: true })),
  };
};
const said = (data: ProfileInput) =>
  suggestionsOf(data).map((s) => [s.id, s.short, s.why, s.worthCents, s.confidence.percent]);

describe("one statement file, uploaded on different days", () => {
  it("gives the same suggestions, word for word", async () => {
    const [first, ...rest] = await Promise.all(UPLOAD_DAYS.map(uploadedOn));
    const expected = said(first!);
    expect(expected.some(([id]) => id === "safe_to_spend:emergency_fund")).toBe(true);
    rest.forEach((data, i) => expect(said(data), UPLOAD_DAYS[i + 1]).toEqual(expected));
  });
});
