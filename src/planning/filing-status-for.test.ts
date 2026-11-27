import { describe, expect, it } from "vitest";
import { filingStatusWithEarners } from "./student-tax";
import { filingStatusFor, type StoredFiling } from "./tax-profile";

const told = (value: unknown, at: string | null = null) => ({
  filing_status: { value, at: at ? new Date(at) : null },
});
const row = (
  filingStatus: string | null,
  at: string | null = null,
  answered = true,
): StoredFiling => ({
  filingStatus,
  answered: answered ? ["filingStatus"] : [],
  at: at ? new Date(at) : null,
});

describe("filingStatusWithEarners (the Saver's Credit's read)", () => {
  it("reads a family with one earner, or an earner count not known, as a head of household", () => {
    const family = (earners: unknown) => ({
      household: { value: "family" },
      earners: { value: earners },
    });
    expect(filingStatusWithEarners(family(1))).toBe("head_of_household");
    expect(filingStatusWithEarners(family(undefined))).toBe("head_of_household");
    expect(filingStatusWithEarners(family(2))).toBe("married_joint");
    // And what they said still wins.
    expect(
      filingStatusWithEarners({ ...family(1), filing_status: { value: "married_separate" } }),
    ).toBe("married_separate");
  });
});

describe("filingStatusFor", () => {
  it("reads what the person told Jane, and the tax profile's answer when that is all there is", () => {
    expect(filingStatusFor(told("married_joint"), null)).toMatchObject({
      status: "married_joint",
      source: "told",
    });
    expect(filingStatusFor({}, row("head_of_household"))).toMatchObject({
      status: "head_of_household",
      source: "profile",
    });
  });

  it("settles two answers that differ by the newer one, and says which it set aside", () => {
    const newerProfile = filingStatusFor(
      told("single", "2026-10-01T10:00:00Z"),
      row("married_joint", "2026-10-02T10:00:00Z"),
    );
    expect(newerProfile).toMatchObject({
      status: "married_joint",
      source: "profile",
      replaced: "single",
    });
    const newerTold = filingStatusFor(
      told("single", "2026-10-03T10:00:00Z"),
      row("married_joint", "2026-10-02T10:00:00Z"),
    );
    expect(newerTold).toMatchObject({
      status: "single",
      source: "told",
      replaced: "married_joint",
    });
  });

  it("compares instants: 3pm and 7pm Pacific are on either side of UTC midnight and still in order", () => {
    const read = filingStatusFor(
      told("single", "2026-11-05T23:00:00Z"),
      row("head_of_household", "2026-11-06T03:00:00Z"),
    );
    expect(read.status).toBe("head_of_household");
  });

  it("lets the told fact win at the same instant or when a time is not known", () => {
    const at = "2026-10-01T10:00:00Z";
    expect(filingStatusFor(told("single", at), row("married_joint", at)).status).toBe("single");
    expect(filingStatusFor(told("single", at), row("married_joint", null)).status).toBe("single");
    expect(filingStatusFor(told("single", null), row("married_joint", at)).status).toBe("single");
  });

  it("ignores a profile row the person never answered, and a value that is not a status", () => {
    expect(filingStatusFor({}, row("married_joint", null, false)).source).toBe("default");
    expect(filingStatusFor(told("jointly"), row("nonsense")).source).toBe("default");
  });

  it("guesses a couple from a joint account or two employers, as the estimate always did", () => {
    const read = filingStatusFor({}, null, { jointAccounts: 1, payrollNames: [] });
    expect(read).toMatchObject({ status: "married_joint", source: "guess" });
    expect(read.guess?.why).toBe("a joint account");
    // What the person said beats any guess.
    expect(filingStatusFor(told("single"), null, { jointAccounts: 2 }).status).toBe("single");
  });

  it("then reads the household, then says single", () => {
    expect(filingStatusFor({}, null, { household: "couple" })).toMatchObject({
      status: "married_joint",
      source: "household",
    });
    expect(filingStatusFor({}, null, { household: "family", earners: 2 }).status).toBe(
      "married_joint",
    );
    expect(filingStatusFor({}, null, { household: "family", earners: 1 }).status).toBe(
      "head_of_household",
    );
    // No count of earners: a family files jointly (the student cards).
    expect(filingStatusFor({}, null, { household: "family" }).status).toBe("married_joint");
    expect(filingStatusFor({}, null, { household: "single" })).toMatchObject({
      status: "single",
      source: "default",
    });
  });
});
