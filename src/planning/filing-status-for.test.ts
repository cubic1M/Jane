import { describe, expect, it } from "vitest";
import { filingReadOf, filingStatusOf } from "./student-tax";
import { FILING_SINGLE_ASSUMPTION, filingStatusFor, type StoredFiling } from "./tax-profile";

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

describe("filingStatusOf (the cards' read)", () => {
  // T8b: the Saver's Credit used to read one earner with children as a head of household, and the
  // student cards a family as filing jointly. Both are single now unless a sign of a partner is seen.
  it("reads a family with no sign of a partner as single, with the assumption, never head of household", () => {
    const family = { household: { value: "family" }, has_children: { value: true } };
    expect(filingStatusOf(family)).toBe("single");
    expect(filingReadOf(family).assumption).toBe(FILING_SINGLE_ASSUMPTION);
    expect(filingStatusOf({ ...family, earners: { value: 1 } })).toBe("single");
  });
  it("reads a seen or told partner as married filing jointly, and the person's own word over both", () => {
    const kids = { has_children: { value: true } };
    expect(filingStatusOf({ ...kids, has_partner: { value: true, source: "seen" } })).toBe(
      "married_joint",
    );
    expect(filingStatusOf({ ...kids, household: { value: "couple", source: "told" } })).toBe(
      "married_joint",
    );
    // A guessed household of a couple (payroll names) is not the person's word.
    expect(filingStatusOf({ household: { value: "couple", source: "guessed" } })).toBe("single");
    // "No partner" takes the signs back.
    expect(
      filingReadOf({ ...kids, has_partner: { value: false, source: "told" } }).assumption,
    ).toBe(FILING_SINGLE_ASSUMPTION);
    // What they said about how they file still wins.
    expect(filingStatusOf({ ...kids, filing_status: { value: "married_separate" } })).toBe(
      "married_separate",
    );
    expect(filingReadOf({ ...kids, filing_status: { value: "head_of_household" } })).toMatchObject({
      status: "head_of_household",
      assumption: null,
    });
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

  it("is single without a sign of a partner, and never head of household, with the assumption beside children", () => {
    expect(filingStatusFor({}, null, {})).toMatchObject({
      status: "single",
      source: "default",
      assumption: null,
    });
    const withChildren = filingStatusFor({}, null, { children: true });
    expect(withChildren).toMatchObject({ status: "single", assumption: FILING_SINGLE_ASSUMPTION });
    // Children and a partner (told, or a joint account): joint, nothing assumed.
    expect(filingStatusFor({}, null, { children: true, partner: true })).toMatchObject({
      status: "married_joint",
      assumption: null,
    });
    expect(filingStatusFor({}, null, { children: true, jointAccounts: 1 }).status).toBe(
      "married_joint",
    );
    // "No partner" beats a joint account.
    expect(filingStatusFor({}, null, { partner: false, jointAccounts: 1 }).status).toBe("single");
    // Told answers carry no assumption.
    expect(
      filingStatusFor(told("head_of_household"), null, { children: true }).assumption,
    ).toBeNull();
  });
});
