import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTORS, runDetectors } from "@/detectors";
import { addDays, daysBetween } from "@/lib/dates";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { unexplained } from "./diff";
import { DATED } from "./reasons";

// Gate C, 11-20: the renter's "Check Xfinity's low-cost internet, save $720 a year" went on
// 2028-02-29 in the leap-day window. Not the leap day: the renter's data ends Jan 14, and Feb 29 is
// its 46th day, past STALE_UPLOAD_DAYS (45), when a card about what's paid now waits for newer
// statements (#2095). The sweep's reason for that day listed three of the four such cards.
// Rerun just those days: SWEEP_PEOPLE=renter SWEEP_WINDOWS=leap-day SWEEP_MODES=frozen
// SWEEP_FROM=2028-02-28 SWEEP_DAYS=3. On main after 11-20's income changes (#2183, #2189) the
// renter no longer gets the card in that window, so that rerun passes either way: the renter below
// is built so the card comes, and holds the reason to it.

const reason = DATED.find((r) => r.name === "statements too old to say what's now")!;

describe("every card that waits for newer statements", () => {
  it("is named in the sweep's reason for that day", () => {
    const dir = "src/detectors";
    const topics = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "helpers.ts")
      .flatMap((f) => {
        const text = readFileSync(`${dir}/${f}`, "utf8");
        return [...text.matchAll(/statementsTooOld\(/g)].map((m) => {
          const before = text.slice(0, m.index);
          const last = (re: RegExp) => [...before.matchAll(re)].at(-1)?.[1];
          return `${last(/capability: "([^"]+)"/g)}:${last(/topic: "([^"]+)"/g)}`;
        });
      });
    expect(topics.length).toBeGreaterThanOrEqual(4);
    expect(topics.filter((t) => !reason.paths.test(`suggestions.${t}.headline`))).toEqual([]);
  });
});

// Debug 3, 11-22 (#2223's cardPages, gate C's frozen sweep): a snapshot field read from a function
// that stops on statementsTooOld (the pages the cheaper-plan and cushion cards open) went on every
// person's 46th day with no reason. Each such field the snapshot reads is named in the reason too.
describe("every snapshot field read from a figure that waits for newer statements", () => {
  it("is named in the sweep's reason for that day", () => {
    // The exported functions in src/detectors that stop on statementsTooOld.
    const stops = readdirSync("src/detectors")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .flatMap((f) => {
        const text = readFileSync(`src/detectors/${f}`, "utf8");
        // Each top-level declaration, to the next one.
        return text.split(/\n(?=export |function |const |type )/).flatMap((chunk) => {
          const name = /^export function (\w+)\(/.exec(chunk)?.[1];
          return name && name !== "statementsTooOld" && /statementsTooOld\(/.test(chunk)
            ? [name]
            : [];
        });
      });
    expect(stops).toEqual(expect.arrayContaining(["cheaperPlansOf", "cushionOf"]));
    // In the snapshot: the variables they fill, then the fields that read those variables, each
    // under the object it sits in.
    const lines = readFileSync("src/sweep/snapshot.ts", "utf8").split("\n");
    const filled = lines.flatMap((l) => {
      const m = /const (\w+) = (\w+)\(/.exec(l);
      return m && stops.includes(m[2]!) ? [m[1]!] : [];
    });
    expect(filled.length).toBeGreaterThanOrEqual(2);
    const fields: string[] = [];
    let parent = "";
    for (const l of lines) {
      const open = /^ {4}(\w+): \{$/.exec(l);
      if (open) parent = open[1]!;
      const field = /^ {6}(\w+): (.*)$/.exec(l);
      if (parent && field && filled.some((v) => new RegExp(`(?<![.\\w])${v}\\b`).test(field[2]!)))
        fields.push(`${parent}.${field[1]}`);
    }
    expect(fields).toEqual(
      expect.arrayContaining(["cardPages.plansYearlyCents", "cardPages.cushionShortCents"]),
    );
    expect(fields.filter((f) => !reason.paths.test(f))).toEqual([]);
  });
});

// Every date moved by the same number of days, so the data ends on `newest`.
const endingOn = (data: ProfileInput, newest: string): ProfileInput => {
  const last = data.transactions.reduce((m, t) => (t.date > m ? t.date : m), "0000-00-00");
  const shift = daysBetween(last, newest);
  return {
    ...data,
    transactions: data.transactions.map((t) => ({ ...t, date: addDays(t.date, shift) })),
  };
};
const internet = (data: ProfileInput, today: string) =>
  runDetectors({ profile: buildProfile({ ...data, today }), data: { ...data, today } }, DETECTORS)
    .map((s) => s.topic)
    .includes("low_cost_internet");

// The renter with an Xfinity bill and $1,600 a month take-home, under the plan's line for one, as
// the internet cards' own test has them (src/detectors/lifeline-internet.test.ts).
const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";
const base = inputFor("renter");
const data: ProfileInput = {
  ...base,
  householdSize: 1,
  told: { ...base.told, monthly_income: 160_000 },
  transactions: [
    ...base.transactions.filter((t) => t.pfc !== INTERNET),
    ...["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({
      date,
      amountCents: 7_499,
      description: "COMCAST XFINITY",
      pfc: INTERNET,
      accountId: base.accounts[0]!.id,
    })),
  ],
};

describe("the low-cost internet card across a leap day", () => {
  it("goes on the data's 46th day, in a leap year as in any other", () => {
    const leap = endingOn(data, "2028-01-14");
    expect(internet(leap, "2028-02-28")).toBe(true);
    expect(internet(leap, "2028-02-29")).toBe(false);
    const plain = endingOn(data, "2027-01-14");
    expect(internet(plain, "2027-02-28")).toBe(true);
    expect(internet(plain, "2027-03-01")).toBe(false);
  });

  it("is a move the sweep names on that day, and only that day", () => {
    const gone = [
      { path: "suggestions.cost:low_cost_internet.headline", before: "Check…", after: undefined },
    ];
    const renter = { linked: "2028-01-15", lastLine: "2028-01-14" };
    expect(unexplained("2028-02-29", gone, DATED, renter)).toEqual([]);
    expect(unexplained("2028-02-28", gone, DATED, renter)).toEqual(gone);
  });
});
