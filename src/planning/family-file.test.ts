import { describe, expect, it } from "vitest";
import { APPROVED_FAMILY_SENTENCES, ESTATE_FACTS, ESTATE_POINTER } from "@/config/family-file";
import { checkGuardrails } from "@/lib/guardrails";
import { buildFile, checkAccounts, needsAttention, type BeneficiaryRow } from "./family-file";

const accounts = [
  { id: "k", name: "Work 401(k)", subtype: "401k", mask: "1234" },
  { id: "i", name: "Roth IRA", subtype: "roth", mask: "5678" },
  { id: "b", name: "Brokerage", subtype: "brokerage", mask: "9999" },
  { id: "c", name: "Credit card", subtype: "credit card" },
];
const row = (
  accountId: string,
  name: string,
  sharePct: number,
  confirmedOn: string,
): BeneficiaryRow => ({
  accountId,
  name,
  relationship: "spouse",
  sharePct,
  tier: "primary",
  confirmedOn,
});

describe("checking beneficiaries", () => {
  it("flags an account that takes a beneficiary and has none, and ignores accounts that don't", () => {
    const checks = checkAccounts(accounts, [], []);
    expect(checks.map((c) => c.accountId)).toEqual(["k", "i", "b"]);
    expect(checks.find((c) => c.accountId === "k")!.problems).toEqual(["missing"]);
    // A brokerage can be set up to transfer on death, but not having one isn't a mistake.
    const b = checks.find((c) => c.accountId === "b")!;
    expect(b.type).toBe("tod");
    expect(b.problems).toEqual([]);
  });

  it("flags names confirmed before a marriage, a divorce or a birth", () => {
    const rows = [row("k", "Ex", 100, "2020-01-01"), row("i", "Sam", 100, "2026-09-01")];
    const checks = checkAccounts(accounts, rows, [
      { kind: "divorce", on: "2024-05-01" },
      { kind: "birth", on: "2026-03-01" },
    ]);
    const k = checks.find((c) => c.accountId === "k")!;
    expect(k.problems).toEqual(["out_of_date"]);
    expect(k.because).toBe("birth");
    // Confirmed after both events: fine.
    expect(checks.find((c) => c.accountId === "i")!.problems).toEqual([]);
  });

  it("flags primary shares that don't add up to 100", () => {
    const rows = [row("k", "A", 50, "2026-09-01"), row("k", "B", 30, "2026-09-01")];
    expect(checkAccounts(accounts, rows, []).find((c) => c.accountId === "k")!.problems).toEqual([
      "shares",
    ]);
    expect(needsAttention(checkAccounts(accounts, rows, []))).toHaveLength(2);
  });
});

describe("the family file shares only what the person picks", () => {
  const data = {
    accounts,
    checks: checkAccounts(accounts, [row("k", "Sam", 100, "2026-09-01")], []),
    contacts: [{ name: "Pat Lee", role: "lawyer", phone: "555-0100", email: null }],
    documents: "Folder in the hall closet",
  };
  it("includes a section only when picked", () => {
    const none = buildFile([], data, "2026-10-20");
    expect(none).not.toMatch(/401\(k\)|Pat Lee|closet|Sam/);
    const some = buildFile(["contacts"], data, "2026-10-20");
    expect(some).toMatch(/Pat Lee \(lawyer\) 555-0100/);
    expect(some).not.toMatch(/401\(k\)|Sam|closet/);
    const all = buildFile(
      ["accounts", "beneficiaries", "contacts", "documents"],
      data,
      "2026-10-20",
    );
    expect(all).toMatch(/Work 401\(k\) \(ending 1234\)/);
    expect(all).toMatch(/Work 401\(k\): Sam/);
    expect(all).toMatch(/closet/);
  });
  it("never includes balances or other sections' headings when not picked", () => {
    const text = buildFile(["accounts"], data, "2026-10-20");
    expect(text).not.toMatch(/\$|People to call|Who I have named/);
  });
});

describe("wills and trusts: facts and a pointer to counsel, never legal advice", () => {
  it("lets the reviewed sentences through", () => {
    for (const s of [...ESTATE_FACTS, ESTATE_POINTER]) {
      expect(checkGuardrails(s, []), s).toEqual({ ok: true });
    }
    expect(checkGuardrails(APPROVED_FAMILY_SENTENCES.join(" "), [])).toEqual({ ok: true });
  });
  it.each([
    "You should put your house in a trust.",
    "Write a will leaving everything to your children.",
    "A revocable living trust would avoid probate for you.",
    "Name your sister as executor.",
    "Set up a power of attorney.",
    "Your estate plan needs a new will and testament.",
    "A trust is better than a will for you.",
  ])("blocks %j", (text) => {
    const r = checkGuardrails(text, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("tax_or_legal_advice");
  });
  it("blocks the reviewed sentences once they are changed", () => {
    expect(
      checkGuardrails(ESTATE_FACTS[0].replace("usually", "always") + " Make one now.", []).ok,
    ).toBe(false);
  });
  it("also blocks them under the demo advice profile", () => {
    const r = checkGuardrails("Create a trust for your kids.", [], undefined, "demo_advice");
    expect(r.ok).toBe(false);
  });
  it("allows the plain fact about beneficiaries", () => {
    expect(
      checkGuardrails(
        "Your 401(k) names nobody, so a form decides who gets it.",
        [],
        undefined,
        "demo_advice",
      ),
    ).toEqual({ ok: true });
  });
});
