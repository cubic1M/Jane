import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { DETECTORS, runDetectors } from "./index";
import { yearIncomeOf } from "./helpers";

// Gate C's calendar sweep (11-20) on main, Dec 31 against Jan 1 over data held still: the tax
// cards' "Income near $X" read 2026's pay on Dec 31 and 2027's month as a year on Jan 1, with no
// year named, so a person saw their yearly income move overnight. And the Saver's Credit, for the
// 2026 tax year and shown until April 2027, took 2027's figure from Jan 1. Each card names the
// year its income is for, and a card for a year that has ended keeps that year's figure.

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Pay twice a month from October 2025 to October 23, 2026, then nothing new (frozen data).
const paydays = Array.from({ length: 13 }, (_, i) => [
  addDays(
    `${2025 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, "0")}-01`,
    7,
  ),
  addDays(
    `${2025 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, "0")}-01`,
    22,
  ),
])
  .flat()
  .filter((d) => d <= "2026-10-23");
const on = (today: string): ProfileInput => ({
  today,
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 210_000 }],
  liabilities: [],
  told: { home_state: "CA", household: 1 },
  transactions: [
    ...paydays.map((date) => ({
      date,
      amountCents: -90_000,
      description: "ACME CORP PAYROLL PPD",
      pfc: "INCOME_SALARY",
      accountId: "chk",
    })),
    ...paydays.map((date) => ({
      date: addDays(date, 2),
      amountCents: 6_500,
      description: "AT&T WIRELESS BILL PAY",
      pfc: "RENT_AND_UTILITIES_TELEPHONE",
      accountId: "chk",
    })),
  ],
});
const cards = (today: string) => {
  const data = on(today);
  return runDetectors({ profile: buildProfile(data), data }, DETECTORS);
};
const nearOf = (today: string) =>
  cards(today).flatMap((s) =>
    [...`${s.short} ${s.why}`.matchAll(/(\S+) income near (\$[\d,]+\.\d{2})/gi)].map(
      (m) => `${s.topic}: ${m[1]} ${m[2]}`,
    ),
  );

describe("the year's income across Jan 1", () => {
  it("names the year on every card that says income near", () => {
    for (const today of ["2026-12-31", "2027-01-01"]) {
      const said = cards(today).flatMap((s) =>
        [...`${s.short} ${s.why}`.matchAll(/(\S+ )?income near/gi)].map((m) => m[0]),
      );
      expect(said.length, today).toBeGreaterThan(0);
      for (const s of said) expect(s, today).toMatch(/^\d{4} income near/i);
    }
  });

  it("names it in every card's words that say income near", () => {
    for (const file of readdirSync("src/detectors").filter((f) => /^[a-z-]+\.ts$/.test(f))) {
      for (const line of readFileSync(`src/detectors/${file}`, "utf8").split("\n")) {
        if (!/[`"].*income near \$\{/i.test(line) || /^\s*\/\//.test(line)) continue;
        expect(line, file).toMatch(
          /\$\{(?:incomeYearOf\([^)]*\)|SAVERS_CREDIT\.taxYear)\} income near/,
        );
      }
    }
  });

  it("keeps the Saver's Credit on 2026's income in January", () => {
    const saver = (today: string) => nearOf(today).filter((s) => s.startsWith("savers_credit"));
    expect(saver("2026-12-31").length).toBeGreaterThan(0);
    expect(saver("2027-01-01")).toEqual(saver("2026-12-31"));
    expect(saver("2027-01-01")[0]).toMatch(/^savers_credit: 2026 /);
  });

  it("reads last year's figure on Jan 1 as Dec 31 read this year's, to the cent", () => {
    const dec31 = on("2026-12-31");
    const jan1 = on("2027-01-01");
    expect(yearIncomeOf(buildProfile(jan1), jan1, 2026)).toBe(
      yearIncomeOf(buildProfile(dec31), dec31),
    );
  });
});
