import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "@/detection/units";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFromStatements } from "./__fixtures__/student-walk";
import { runDetectors } from "./index";
import { MONEY_DETECTORS } from "./money";

// Gate C (debug 3, 11-19): debug 2's sweep 7 read the S4 upload's cushion as $4,971.36 on 11-18
// and $4,919.01 on 11-19 ($1,657.12 → $1,639.67 a month). Those were two uploads of the same file,
// one a day later: an upload's history ends where its statement closes, never past the day it came
// in (dataEnd), so a day later is one more day of months. Held fixed after one upload, the cushion
// must read the same every day until the statements are too old to say what's now.

const S4 = "src/lib/jane-agent/checks/__fixtures__/cells/upload-s4-desktop/chase-checking.csv";

const uploaded = async (on: string): Promise<ProfileInput> => {
  const data = await inputFromStatements(
    [{ name: "chase-checking.csv", text: readFileSync(S4, "utf8") }],
    on,
  );
  // The file's own balance after its newest line, as the upload reads it.
  return {
    ...data,
    accounts: data.accounts.map((a) => ({ ...a, balanceCents: 308_733, balanceKnown: true })),
  };
};
const cushion = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, MONEY_DETECTORS).find(
    (s) => s.topic === "emergency_fund",
  )?.why;

describe("the cushion of an upload, held fixed", () => {
  it("reads the same every day after the upload, until the statements are too old", async () => {
    const data = await uploaded("2026-11-18");
    const first = cushion(data);
    expect(first).toBeDefined();
    // The newest line is Nov 13; on the 46th day after it the card waits (statementsTooOld).
    for (let day = 1; day <= 40; day += 1) {
      const today = addDays(data.today, day);
      expect(cushion({ ...data, today }), today).toBe(first);
    }
  });
});
