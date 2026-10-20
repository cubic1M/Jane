import { describe, expect, it } from "vitest";
import { NOTICE_KINDS, isNoticeKind } from "@/config/tax-notices";
import { checkAgainstWhatJaneKnows, checkNotice, draftResponse, dueDate } from "./tax-notice";

// Spec step 217: notice kinds and deadlines come from config, with sources; the reading is
// checked; the reply is drafted from what Jane knows.

const TODAY = "2026-10-19";

describe("notice kinds", () => {
  it("each has a source, a deadline rule and a reply that makes sense", () => {
    for (const [kind, rule] of Object.entries(NOTICE_KINDS)) {
      expect(isNoticeKind(kind)).toBe(true);
      expect(rule.source, kind).toMatch(/^https:\/\/|^Your state/);
      expect(rule.days, kind).toBeGreaterThan(0);
      expect(rule.responses.length, kind).toBeGreaterThan(0);
    }
    // A proposal can be agreed to; a balance is paid. Both can be disputed.
    expect(NOTICE_KINDS.CP2000.responses).toEqual(["agree", "dispute"]);
    expect(NOTICE_KINDS.CP14.responses).toEqual(["pay", "dispute"]);
    expect(NOTICE_KINDS.CP2000.days).toBe(30);
    expect(NOTICE_KINDS.CP14.days).toBe(21);
  });

  it("takes the date to respond by from the notice, else its date plus the usual days", () => {
    expect(dueDate({ kind: "CP2000", noticeDate: "2026-10-01", respondBy: "2026-11-05" })).toBe(
      "2026-11-05",
    );
    expect(dueDate({ kind: "CP2000", noticeDate: "2026-10-01" })).toBe("2026-10-31");
    expect(dueDate({ kind: "CP14", noticeDate: "2026-10-01" })).toBe("2026-10-22");
    expect(dueDate({ kind: "CP504", noticeDate: "2026-10-01" })).toBe("2026-10-31");
    expect(dueDate({ kind: "CP14" })).toBeNull();
  });
});

describe("reading a notice", () => {
  it("keeps what parses and notes what doesn't", () => {
    const c = checkNotice(
      {
        kind: "CP2000",
        taxYear: "2024",
        noticeDate: "2026-10-01",
        respondBy: "soon",
        amount: "1,234.50",
        reportedIncome: "lots",
      },
      { kind: "document", amount: "document" },
      { today: TODAY },
    );
    expect(c.fields).toMatchObject({ kind: "CP2000", taxYear: "2024", amount: "1,234.50" });
    expect(c.fields.respondBy).toBeUndefined();
    expect(c.notes.respondBy).toBe("I couldn't read that date. Type it as YYYY-MM-DD.");
    expect(c.notes.reportedIncome).toBe("I couldn't read that amount. Type it from the notice.");
    expect(checkNotice({ kind: "CP9999" }, {}, { today: TODAY }).notes.kind).toBe(
      "Pick which notice it is.",
    );
    expect(checkNotice({ taxYear: "2010" }, {}, { today: TODAY }).notes.taxYear).toBeDefined();
  });
});

describe("checking a notice against what Jane knows", () => {
  const cp2000 = {
    kind: "CP2000",
    payer: "Acme Freelance LLC",
    reportedIncome: "9,000",
    amount: "1,100",
  } as const;

  it("points to agreeing when the income is really there", () => {
    const c = checkAgainstWhatJaneKnows(cp2000, {
      forms: [{ form: "1099-NEC", from: "ACME FREELANCE LLC", cents: 900_000 }],
      incomeByPayer: [],
      payments: [],
    });
    expect(c.points).toBe("agree");
    expect(c.lines).toEqual(["I have the form from ACME FREELANCE LLC: $9,000.00."]);
  });

  it("points to disagreeing when the records say a different amount, or nothing", () => {
    const different = checkAgainstWhatJaneKnows(cp2000, {
      forms: [],
      incomeByPayer: [{ payer: "Acme Freelance", cents: 600_000 }],
      payments: [],
    });
    expect(different.points).toBe("dispute");
    expect(different.why).toBe("The notice says $9,000.00, but I see $6,000.00.");
    const none = checkAgainstWhatJaneKnows(cp2000, { forms: [], incomeByPayer: [], payments: [] });
    expect(none.points).toBe("dispute");
    expect(none.lines).toEqual(["I can't find Acme Freelance LLC in your forms or accounts."]);
  });

  it("points to paying a balance, or to disputing one already paid", () => {
    const cp14 = { kind: "CP14", amount: "1,500" } as const;
    expect(
      checkAgainstWhatJaneKnows(cp14, { forms: [], incomeByPayer: [], payments: [] }).points,
    ).toBe("pay");
    const paid = checkAgainstWhatJaneKnows(cp14, {
      forms: [],
      incomeByPayer: [],
      payments: [{ date: "2026-04-15", payee: "IRS USATAXPYMT", cents: 150_000 }],
    });
    expect(paid.points).toBe("dispute");
    expect(paid.lines).toEqual(["You paid $1,500.00 to IRS USATAXPYMT on 2026-04-15."]);
  });

  it("says when there's not enough to check", () => {
    expect(
      checkAgainstWhatJaneKnows({ kind: "CP2000" }, { forms: [], incomeByPayer: [], payments: [] })
        .points,
    ).toBeNull();
  });
});

describe("the drafted reply", () => {
  it("leaves the person's own details in brackets, and lists the documents to attach", () => {
    const d = draftResponse(
      "dispute",
      {
        kind: "CP2000",
        noticeDate: "2026-10-01",
        taxYear: "2024",
        payer: "Acme",
        reason: "Unreported income.",
      },
      ["Your 1099-NEC from Acme"],
    );
    expect(d.body).toContain("[Your name]");
    expect(d.body).toContain("Re: CP2000 notice dated 2026-10-01, tax year 2024");
    expect(d.body).toContain(
      "I disagree with this notice about income from Acme (Unreported income)",
    );
    expect(d.body).toContain("- Your 1099-NEC from Acme");
    expect(draftResponse("agree", { kind: "CP2000", amount: "1,100" }, []).body).toContain(
      "agree with the proposed changes of $1,100",
    );
    expect(draftResponse("pay", { kind: "CP14", amount: "1,500" }, []).body).toContain(
      "IRS Direct Pay",
    );
  });
});
