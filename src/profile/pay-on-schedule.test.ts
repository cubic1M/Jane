import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { inputFromStatements, suggestionsOf } from "@/detectors/__fixtures__/student-walk";
import { yearIncomeOf } from "@/detectors/helpers";
import { buildProfile } from "@/profile/build";

// Pay on a schedule is a month by its schedule, not by how many paydays one window happens to
// catch (debug 3, 11-19). Upload S5, one month of Chase checking (Oct 15 to Nov 14): University of
// California pays $620.00 every two weeks, and all three of Oct 15, Oct 29 and Nov 12 fall in the
// file. Divided by the file's one month that read $1,860 a month, and the Saver's Credit card
// "Income near $28,489.50"; every two weeks is 26 × $620 / 12 = $1,343.33 a month.

const S5 =
  "src/lib/jane-agent/checks/__fixtures__/cells/upload-s5-phone/Chase1234_Activity_20261115.CSV";
const READ = "2026-11-19";
const MONTH = Math.round((26 * 62_000) / 12);
const YEAR = Math.round(MONTH * 12 * DETECTOR_RATES.tax.netToGross);
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const s5 = () =>
  inputFromStatements(
    [{ name: "Chase1234_Activity_20261115.CSV", text: readFileSync(S5, "utf8") }],
    READ,
  );

describe("three paychecks every two weeks in one month's file", () => {
  it("is a month of pay by the schedule", async () => {
    const profile = buildProfile(await s5());
    expect(profile.facts.monthly_income.value).toBe(MONTH);
  });

  it("is the same year on the tax cards as in the profile", async () => {
    const data = await s5();
    const profile = buildProfile(data);
    expect(yearIncomeOf(profile, data)).toBe(YEAR);
    const near = suggestionsOf(data)
      .flatMap((s) => [s.short, s.why])
      .flatMap((text) =>
        [...String(text).matchAll(/income near (\$[\d,]+\.\d{2})/gi)].map((m) => m[1]),
      );
    expect(near.length).toBeGreaterThan(0);
    expect(new Set(near)).toEqual(new Set([dollars(YEAR)]));
  });
});
