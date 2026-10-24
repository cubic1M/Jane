import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { ACTION_HANDLERS } from "./actions";
import { findTaxFacts, taxProfileView, type StoredTaxProfile } from "@/planning/tax-profile";
import { taxesSource } from "./sources/taxes";
import type { Snapshot } from "./snapshot";
import { PROFILE_DONE, nextQuestion } from "./tax-flow";
import { setFilingReply, setKidsReply, setStateReply, taxProfileReply } from "./tax-replies";
import { ACTION_IDS } from "./types";

// Spec step 118: the tax profile in the chat, one question at a time.

const PAY = [1, 15].map((d) => ({
  date: `2026-09-${String(d).padStart(2, "0")}`,
  amountCents: -245_000,
  pfcDetailed: "INCOME_SALARY",
  description: "ACME CORP PAYROLL",
  merchantName: null,
}));
const found = findTaxFacts({
  transactions: PAY,
  accounts: [],
  settingsState: "CA",
  newBaby: true,
});
const view = (s: Partial<StoredTaxProfile> | null) =>
  taxProfileView(
    s && {
      filingStatus: null,
      childrenUnder17: null,
      otherDependants: null,
      state: null,
      incomeKinds: [],
      answered: [],
      ...s,
    },
    found,
  );
const ids = (q: { actions: { id: string }[] } | null) => q?.actions.map((a) => a.id);

describe("the tax profile questions", () => {
  it("asks about the income Jane found first, then filing, children and the state", () => {
    let q = nextQuestion(view(null));
    expect(q?.body).toBe(
      "From your accounts, your income for 2026 looks like wages from ACME CORP PAYROLL (W-2). Is that all of it?",
    );
    expect(ids(q)).toEqual(["tax.found_yes", "open"]);
    expect(q?.refs).toEqual({ taxField: "incomeKinds" });

    q = nextQuestion(view({ incomeKinds: ["w2"], answered: ["incomeKinds"] }));
    expect(q?.body).toBe("How will you file for 2026?");
    expect(ids(q)).toEqual([
      "tax.filing_single",
      "tax.filing_joint",
      "tax.filing_separate",
      "tax.filing_head",
      "open",
    ]);

    q = nextQuestion(
      view({
        incomeKinds: ["w2"],
        filingStatus: "single",
        answered: ["incomeKinds", "filingStatus"],
      }),
    );
    expect(q?.body).toContain("How many children under 17 will you claim for 2026?");
    // A new-baby checklist: Jane says why she's asking, never assumes.
    expect(q?.body).toContain("I'm asking rather than guessing");
    expect(ids(q)).toEqual(["tax.kids_0", "tax.kids_1", "tax.kids_2", "tax.kids_3", "open"]);

    q = nextQuestion(
      view({
        incomeKinds: ["w2"],
        filingStatus: "single",
        childrenUnder17: 0,
        otherDependants: 0,
        answered: ["incomeKinds", "filingStatus", "dependants"],
      }),
    );
    expect(q?.body).toBe(
      "You live in California, going by your settings. Is that the state you'll file in for 2026?",
    );
    expect(q?.refs).toEqual({ taxField: "state" });
  });

  it("skips what needs the page and sends the person there at the end", () => {
    const none = taxProfileView(
      {
        filingStatus: "single",
        childrenUnder17: 0,
        otherDependants: 0,
        state: null,
        incomeKinds: [],
        answered: ["filingStatus", "dependants"],
      },
      { income: [], state: null, childrenHint: false, dependants: null },
    );
    const q = nextQuestion(none);
    expect(q?.body).toBe(
      'Nearly done. I couldn\'t work out your kinds of income and your state from your accounts, so tell me on your tax profile, or here ("I live in Texas").',
    );
    expect(q?.actions).toEqual([
      { id: "open", label: "Finish my tax profile", kind: "link", href: "/taxes/profile" },
    ]);
  });

  it("stops when the profile is done, and sums it up", () => {
    const done = view({
      incomeKinds: ["w2"],
      filingStatus: "married_joint",
      childrenUnder17: 2,
      otherDependants: 1,
      state: "CA",
      answered: ["incomeKinds", "filingStatus", "dependants", "state"],
    });
    expect(nextQuestion(done)).toBeNull();
    expect(PROFILE_DONE(done)).toBe(
      "That's your tax profile done: married filing jointly, 2 children under 17, 1 other dependant, filing in California, income from wages. I'll keep it up to date from your accounts and tell you if anything new turns up.",
    );
  });

  it("every button it offers is in the registry", () => {
    for (const id of ACTION_IDS.filter((i) => i.startsWith("tax."))) {
      expect(Object.hasOwn(ACTION_HANDLERS, id), id).toBe(true);
    }
  });
});

describe("the taxes message source", () => {
  const snapshot = (tax: Snapshot["tax"]) => ({ tax }) as Snapshot;
  const context = {
    now: new Date("2026-10-19T15:00:00Z"),
    local: { date: "2026-10-19", hour: 8 },
    trigger: "open" as const,
  };

  it("asks once, with Not now, when Jane has found income", () => {
    const [c] = taxesSource.gather(snapshot({ profile: view(null) }), context);
    expect(c).toMatchObject({
      kind: "decision",
      dedupeKey: "profile",
      refs: { taxField: "incomeKinds" },
    });
    expect(c.body.startsWith("Let's get your taxes ready.")).toBe(true);
    expect(c.actions.map((a) => a.id)).toEqual(["tax.found_yes", "open", "snooze"]);
  });

  it("says nothing before there's anything to work from, or once it's done", () => {
    const empty = taxProfileView(null, {
      income: [],
      state: null,
      childrenHint: false,
      dependants: null,
    });
    expect(taxesSource.gather(snapshot({ profile: empty }), context)).toEqual([]);
    expect(taxesSource.gather(snapshot(undefined), context)).toEqual([]);
  });

  it("asks before adding a new kind of income", () => {
    const more = findTaxFacts({
      transactions: [
        ...PAY,
        {
          date: "2026-10-01",
          amountCents: -30_000,
          pfcDetailed: "INCOME_GIG_ECONOMY",
          description: "UBER DRIVER",
          merchantName: "Uber",
        },
      ],
      accounts: [],
      settingsState: null,
      newBaby: false,
    });
    const profile = taxProfileView(
      {
        filingStatus: "single",
        childrenUnder17: 0,
        otherDependants: 0,
        state: "CA",
        incomeKinds: ["w2"],
        answered: ["incomeKinds", "filingStatus", "dependants", "state"],
      },
      more,
    );
    const out = taxesSource.gather(snapshot({ profile }), context);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      dedupeKey: "income:self_employed",
      refs: { incomeKind: "self_employed" },
      body: "I've started seeing freelance or gig pay from Uber (1099-NEC or 1099-K) in your accounts. It isn't on your tax profile yet. Add it?",
    });
    expect(out[0].actions.map((a) => a.id)).toEqual(["tax.income_add", "tax.income_no", "open"]);
  });
});

describe("tax replies", () => {
  it("reads the profile back, marks what Jane found, and asks the next question", () => {
    const reply = taxProfileReply(view(null), "safe");
    expect(reply.body).toContain("- How you file: not set yet");
    expect(reply.body).toContain("- State: California (found by me: check it)");
    expect(reply.body).toContain("- Income: wages from a job (found by me: check it)");
    expect(reply.body).toContain("I keep your tax profile up to date from your accounts");
    expect(reply.actions.map((a) => a.id)).toEqual(["tax.found_yes", "open"]);
    expect(reply.refs).toEqual({ taxField: "incomeKinds" });
  });

  it("offers a button for what was typed, never changes it by itself", () => {
    expect(setFilingReply("single")).toEqual({
      body: 'Want me to put "Single" on your tax profile?',
      actions: [
        { id: "tax.filing_single", label: "Yes, put it on", kind: "primary" },
        { id: "open", label: "See my tax profile", kind: "link", href: "/taxes/profile" },
      ],
      refs: { taxField: "filingStatus" },
    });
    expect(setFilingReply(null).actions.map((a) => a.id)).toEqual([
      "tax.filing_joint",
      "tax.filing_separate",
      "open",
    ]);
    expect(setKidsReply(2).actions[0].id).toBe("tax.kids_2");
    // More than the buttons go to: the page.
    expect(setKidsReply(5).actions).toEqual([
      { id: "open", label: "Open my tax profile", kind: "link", href: "/taxes/profile" },
    ]);
    expect(setStateReply("TX")).toMatchObject({
      body: "Want me to put Texas on your tax profile as the state you file in?",
      refs: { taxField: "state", taxState: "TX" },
    });
  });
});
