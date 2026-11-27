import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TAX_DRAFT_MAX_DAYS, TAX_PARAMS_LEAD_DAYS } from "@/config/invariants";
import { federalParams, type PendingGroup } from "@/config/tax-params";
import { TAX_YEAR_SOURCES } from "@/config/tax-params/watch";
import { defaultTaxYear } from "@/planning/tax-pack";
import { localDate } from "@/lib/today";
import { taxCheckDay, taxYearReady } from "./nightly";

// Tax T32: Jane notices a missing tax year before people do. The figures are passed in, so a year
// added later does not change what these dates prove.
const NOW_2026 = { supported: [2025, 2026], drafts: [], pending: [] } as const;

describe("taxYearReady on frozen days", () => {
  it("is fine on 2026-11-30", () => {
    expect(taxYearReady("2026-11-30", NOW_2026)).toEqual({
      state: "ok",
      day: "2026-11-30",
      messages: [],
    });
  });

  it("warns on 2026-12-01 when there are no 2027 figures", () => {
    const r = taxYearReady("2026-12-01", NOW_2026);
    expect(r.state).toBe("warning");
    expect(r.messages).toEqual(["No tax figures for 2027 yet; 2027 starts soon"]);
  });

  it("starts exactly TAX_PARAMS_LEAD_DAYS before January 1", () => {
    expect(TAX_PARAMS_LEAD_DAYS).toBe(31);
    expect(taxYearReady("2026-11-30", NOW_2026).state).toBe("ok");
    expect(taxYearReady("2026-12-01", NOW_2026).state).toBe("warning");
    expect(taxYearReady("2026-12-31", NOW_2026).state).toBe("warning");
  });

  it("is red on 2027-01-01 and after, while 2027 has no figures", () => {
    for (const day of ["2027-01-01", "2027-05-01", "2027-11-15"]) {
      const r = taxYearReady(day, NOW_2026);
      expect(r.state, day).toBe("red");
      expect(r.messages[0], day).toContain("No tax figures for 2027, the year people are in");
    }
  });

  it("is fine in 2027 once 2027 is supported, and warns again on 2027-12-01 for 2028", () => {
    const with2027 = { ...NOW_2026, supported: [2025, 2026, 2027] };
    expect(taxYearReady("2027-01-01", with2027).state).toBe("ok");
    expect(taxYearReady("2027-11-30", with2027).state).toBe("ok");
    expect(taxYearReady("2027-12-01", with2027).messages).toEqual([
      "No tax figures for 2028 yet; 2028 starts soon",
    ]);
  });

  it("names what is awaited when a draft file exists", () => {
    const pending: PendingGroup[] = [
      { year: 2027, key: "mileage", status: "unconfirmed", checkedOn: "2026-11-27", note: "" },
    ];
    const r = taxYearReady("2026-12-01", { ...NOW_2026, drafts: [2027], pending });
    expect(r.state).toBe("warning");
    expect(r.messages[0]).toBe(
      "No tax figures for 2027 yet; 2027 starts soon (a draft file exists; not final: mileage)",
    );
    expect(
      taxYearReady("2027-01-01", { ...NOW_2026, drafts: [2027], pending }).messages[0],
    ).toContain("not final: mileage");
  });
});

describe("a draft figure not looked at for too long", () => {
  const pending: PendingGroup[] = [
    { year: 2026, key: "dependentCare", status: "draft", checkedOn: "2026-11-27", note: "" },
  ];
  const sixty = { ...NOW_2026, pending };

  it("is fine for TAX_DRAFT_MAX_DAYS and warns the day after", () => {
    expect(TAX_DRAFT_MAX_DAYS).toBe(60);
    // 2026-11-27 + 60 days = 2027-01-26.
    expect(taxYearReady("2026-11-28", { ...sixty, supported: [2025, 2026, 2027] }).state).toBe(
      "ok",
    );
    expect(taxYearReady("2027-01-26", { ...sixty, supported: [2025, 2026, 2027] }).state).toBe(
      "ok",
    );
    const late = taxYearReady("2027-01-27", { ...sixty, supported: [2025, 2026, 2027] });
    expect(late.state).toBe("warning");
    expect(late.messages).toEqual(["2026 dependentCare is still draft, last read 2026-11-27"]);
  });

  it("keeps red when a warning and a red come together", () => {
    const r = taxYearReady("2027-03-01", sixty);
    expect(r.state).toBe("red");
    expect(r.messages).toHaveLength(2);
  });
});

describe("the real figures", () => {
  it("has a year for every group a source feeds, and no source named twice", () => {
    const keys = Object.keys(federalParams(2026));
    const names = TAX_YEAR_SOURCES.map((s) => s.key);
    expect(new Set(names).size).toBe(names.length);
    for (const s of TAX_YEAR_SOURCES) {
      for (const group of s.feeds) expect(keys, `${s.key} feeds ${group}`).toContain(group);
    }
  });

  it("is fine today (2026-11-27)", () => {
    expect(taxYearReady("2026-11-27").state).toBe("ok");
  });
});

describe("the day it runs for", () => {
  it("is the furthest-ahead day: Dec 1 at 10:00 UTC, when it is midnight in UTC+14", () => {
    expect(taxCheckDay(new Date("2026-11-30T09:59:59Z"))).toBe("2026-11-30");
    expect(taxCheckDay(new Date("2026-11-30T10:00:00Z"))).toBe("2026-12-01");
  });

  it("is never behind any person's own day, either side of UTC midnight and of New Year", () => {
    const zones = [
      "Pacific/Kiritimati",
      "Pacific/Auckland",
      "Asia/Tokyo",
      "UTC",
      "America/Los_Angeles",
      "Pacific/Pago_Pago",
      null,
    ];
    for (let hour = 0; hour < 72; hour++) {
      const now = new Date(Date.UTC(2026, 11, 30, 0) + hour * 3_600_000);
      for (const zone of zones) {
        expect(taxCheckDay(now) >= localDate(now, zone), `${now.toISOString()} ${zone}`).toBe(true);
      }
    }
  });

  it("warns a person in Los Angeles about 2027 on the evening of November 30 there", () => {
    // 2026-12-01T03:00Z is 7pm on November 30 in Los Angeles and already December 1 on the check's clock.
    const now = new Date("2026-12-01T03:00:00Z");
    expect(localDate(now, "America/Los_Angeles")).toBe("2026-11-30");
    expect(taxYearReady(taxCheckDay(now), NOW_2026).state).toBe("warning");
  });
});

describe("the warning comes before the app needs the year", () => {
  it("is red or warning on every day the default tax year has no figures, and a month ahead of the first", () => {
    const supported = { ...NOW_2026, supported: [2025, 2026] };
    let first: string | null = null;
    for (let t = Date.UTC(2026, 5, 1); t <= Date.UTC(2028, 0, 1); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      if (!supported.supported.includes(defaultTaxYear(day))) {
        first ??= day;
        expect(taxYearReady(day, supported).state, day).toBe("red");
      }
    }
    // The tax pack first needs 2027 on 2027-05-01; the check is red from 2027-01-01 and warns from 2026-12-01.
    expect(first).toBe("2027-05-01");
    expect(taxYearReady("2027-04-30", supported).state).toBe("red");
    expect(taxYearReady("2026-12-01", supported).state).toBe("warning");
  });
});

describe("the checklist", () => {
  const doc = readFileSync(join(__dirname, "../../../docs/tax/law-change.md"), "utf8");
  const row = (key: string) => doc.split("\n").find((l) => l.startsWith(`| \`${key}\``)) ?? "";

  it("names every source by key with its address and usual window", () => {
    for (const s of TAX_YEAR_SOURCES) {
      const line = row(s.key);
      expect(line, s.key).not.toBe("");
      expect(line, s.key).toContain(s.url);
      expect(line, s.key).toContain(s.window);
    }
  });

  it("marks a window as general knowledge unless it was read at the source", () => {
    for (const s of TAX_YEAR_SOURCES) {
      const seen = "seen" in s ? s.seen : [];
      if (seen.length === 0) expect(row(s.key), s.key).toContain("general knowledge");
      for (const read of seen) expect(row(s.key), s.key).toContain(read);
    }
  });
});
