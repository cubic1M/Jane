import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStreams } from "@/detection/streams";
import { kindOf } from "@/insights/spending";
import type { BenchFile } from "../csv/layouts";
import { generateCsvPeople, type CsvPerson, type CsvSet } from "../csv/people";
import { runUpload, type Upload } from "../csv/score";
import {
  CARD_LAYOUTS,
  CHECKING_LAYOUTS,
  inLayouts,
  renamed,
  renderOfx,
  shifted,
  withBalancesTyped,
  withRefundedCharge,
} from "./transforms";

// Changes to a statement that must not change what Jane finds, on the real path (the upload's
// reader, the rules and detection; no database, Claude off). No truth is needed, so these hold on
// any statement and no label can be wrong. They can't catch a wrong rule applied the same way every
// time. Every person of every CSV bench set runs through each, in a few seconds' work a relation.
vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));

const SETS: readonly CsvSet[] = ["tuning", "tuning-2", "held-out", "held-out-2", "held-out-3"];
const everyone = SETS.flatMap((set) => generateCsvPeople(undefined, set)).map(withBalancesTyped);
// A credit union's file goes through the column picker: not a layout to swap for another.
const onKnownLayouts = everyone.filter((p) => p.accounts.every((a) => a.layout !== "custom"));

// What a person is told: each finding and its dollars, read as if no bank had a category column.
const said = (up: Upload) =>
  up.findings.map((f) => `${f.type} ${f.key} ${f.annualSavingsCents}`).sort();
const plainly = (person: CsvPerson, render?: (p: CsvPerson) => BenchFile[]) =>
  runUpload(person, { bankCategories: false, ...(render ? { render } : {}) });

// With a bank's own category column there's more to go on, and two things may fairly move: a guess
// the column settles, and a double charge at a place it says is a restaurant, where two small ones
// are two lunches (DUPLICATE_CHARGE_MEAL_MIN_CENTS). The rest must still agree.
const settled = (up: Upload) =>
  up.findings
    .filter(
      (f) =>
        f.type !== "duplicate_charge" &&
        (f.evidence as { onlyItsPrice?: unknown }).onlyItsPrice !== true,
    )
    .map((f) => `${f.type} ${f.key} ${f.annualSavingsCents}`)
    .sort();

const spendingOf = (up: Upload) =>
  up.rows.reduce((sum, r) => (kindOf(r) === "spending" ? sum + r.amountCents : sum), 0);

const LAYOUTS = Array.from({ length: 12 }, (_, i) => ({
  checking: CHECKING_LAYOUTS[i % CHECKING_LAYOUTS.length]!,
  card: CARD_LAYOUTS[i % CARD_LAYOUTS.length]!,
}));
const inEachLayout = (person: CsvPerson, read: (p: CsvPerson) => Promise<Upload>) =>
  Promise.all(
    LAYOUTS.map(({ checking, card }) =>
      read(inLayouts(person, (a) => (a.kind === "credit_card" ? card : checking))),
    ),
  );

describe("one statement through every layout", () => {
  it("finds exactly the same things, with no bank's categories to go on", async () => {
    for (const person of onKnownLayouts) {
      const uploads = await inEachLayout(person, (p) => plainly(p));
      for (const [i, up] of uploads.entries()) {
        expect(up.failedFiles, person.id).toEqual([]);
        expect(said(up), `${person.id} in ${JSON.stringify(LAYOUTS[i])}`).toEqual(
          said(uploads[0]!),
        );
      }
    }
  }, 300_000);

  it("finds the same things where each bank's categories are read, and adds up the same", async () => {
    for (const person of onKnownLayouts) {
      const uploads = await inEachLayout(person, (p) => runUpload(p));
      for (const [i, up] of uploads.entries()) {
        const where = `${person.id} in ${JSON.stringify(LAYOUTS[i])}`;
        expect(settled(up), where).toEqual(settled(uploads[0]!));
        expect(spendingOf(up), where).toBe(spendingOf(uploads[0]!));
      }
    }
  }, 300_000);

  it.each(["name cut at 32 with the line in MEMO", "merchant in NAME, the line in MEMO"] as const)(
    "finds the same things as an OFX download: %s",
    async (style) => {
      for (const person of onKnownLayouts) {
        const base = await plainly(person);
        const up = await plainly(person, (p) => renderOfx(p, style));
        expect(up.failedFiles, person.id).toEqual([]);
        expect(said(up), person.id).toEqual(said(base));
      }
    },
    300_000,
  );
});

describe("moving every date and the clock together", () => {
  // Weeks keep the weekdays; across a month's end, a year's and a leap day.
  it.each([7, 28, 70, 364, 371, -7, 700])(
    "by %i days finds the same things",
    async (days) => {
      for (const person of everyone) {
        const up = await plainly(shifted(person, days));
        expect(said(up), person.id).toEqual(said(await plainly(person)));
      }
    },
    300_000,
  );

  describe("in another time zone", () => {
    const zone = process.env.TZ;
    afterEach(() => {
      process.env.TZ = zone;
    });

    it.each(["America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati"])(
      "%s finds the same things",
      async (name) => {
        const people = everyone.slice(0, 40);
        const bases = await Promise.all(people.map((p) => runUpload(p)));
        process.env.TZ = name;
        for (const [i, person] of people.entries()) {
          expect(said(await runUpload(person)), person.id).toEqual(said(bases[i]!));
        }
      },
      120_000,
    );
  });
});

describe("renaming a merchant to a name no list has heard of", () => {
  // One spelling of the merchant throughout, or the rename would split it in two.
  const oneSpelling = (person: CsvPerson, ids: readonly string[]) => {
    const names = new Set(ids.map((id) => person.rows.find((r) => r.id === id)?.descriptor));
    return names.size === 1 ? [...names][0] : undefined;
  };

  it("keeps its recurrence: the same charges, at the same pace", async () => {
    let renames = 0;
    for (const person of everyone) {
      const base = await runUpload(person);
      for (const stream of buildStreams(base.input)) {
        const ids = stream.charges.map((c) => c.id);
        const descriptor = oneSpelling(person, ids);
        if (!descriptor || ids.length < 3) continue;
        const up = await runUpload(renamed(person, descriptor, "ZORBLAX GOODS"));
        const now = buildStreams(up.input).find((s) => s.charges.some((c) => ids.includes(c.id)));
        expect(now?.charges.map((c) => c.id).sort(), `${person.id} ${descriptor}`).toEqual(
          [...ids].sort(),
        );
        expect(now?.frequency, `${person.id} ${descriptor}`).toBe(stream.frequency);
        renames += 1;
        break;
      }
    }
    // It really ran: nearly everyone has a run of charges to rename.
    expect(renames).toBeGreaterThan(everyone.length * 0.9);
  }, 300_000);
});

describe("a charge and its full refund", () => {
  const withPair = (person: CsvPerson) => {
    const account = person.accounts.find((a) => a.kind === "credit_card") ?? person.accounts[0]!;
    return withRefundedCharge(person, account.id, "2026-09-08", 4321, "ZORBLAX GOODS");
  };

  it("nets out of spending, whichever bank's card it's on", async () => {
    for (const person of onKnownLayouts) {
      for (const card of CARD_LAYOUTS) {
        const inCard = inLayouts(person, (a) => (a.kind === "credit_card" ? card : a.layout));
        const before = spendingOf(await runUpload(inCard));
        const after = spendingOf(await runUpload(withPair(inCard)));
        expect(after, `${person.id} on ${card}`).toBe(before);
      }
    }
  }, 300_000);

  // Idle cash's figure is the one thing that moves, by a dollar or so: its months of spending count
  // what was bought, not what came back, and the bench's truth comes from the same function, so
  // changing it isn't for this suite. Whether there is any idle cash doesn't move.
  const withoutIdleFigure = (up: Upload) =>
    said(up).map((line) => (line.startsWith("idle_cash") ? "idle_cash" : line));

  it("changes nothing Jane finds", async () => {
    for (const person of everyone) {
      const [before, after] = await Promise.all([plainly(person), plainly(withPair(person))]);
      expect(withoutIdleFigure(after), person.id).toEqual(withoutIdleFigure(before));
    }
  }, 300_000);
});
