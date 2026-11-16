import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { uncertainOf, type CloseTx } from "@/planning/month-close";
import { CONTROLLER_DETECTORS } from "./controller";

// Manager 11-16, from the debugger's one-month walk: a student whose only income is a paycheck got
// "Confirm 1 charge to close October: $20 … Openai $20.00: I'm not sure what it was", asked
// whether ChatGPT was "personal or a business cost". A charge Jane's own rules name is never
// called unknown, and only someone self-employed is asked personal or business. For them the close
// (spec step 244) is as it was.

const monthClose = CONTROLLER_DETECTORS.find((d) => d.topic === "month_close")!;
const run = (data: ProfileInput) => monthClose.detect({ profile: buildProfile(data), data });

// Sam, the freelancer sample: WeWork and Adobe in a catch-all category in September.
const sam = inputFor("freelancer");
// The same person paid by an employer instead: their freelance pay is a paycheck.
const paycheckOnly: ProfileInput = {
  ...sam,
  transactions: sam.transactions.map((t) =>
    t.pfc === "INCOME_CONTRACTOR" || t.pfc === "INCOME_GIG_ECONOMY"
      ? { ...t, pfc: "INCOME_SALARY" }
      : t,
  ),
};
const OTHER = "GENERAL_SERVICES_OTHER_GENERAL_SERVICES";
const charge = (description: string, over: Partial<CloseTx> = {}): CloseTx => ({
  id: description,
  date: "2026-10-20",
  amountCents: 2_000,
  description,
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: OTHER,
  categorySource: "rule",
  ...over,
});

describe("the month close's questions", () => {
  it("never calls a charge Jane's rules name unknown, for someone paid by an employer", () => {
    const asked = uncertainOf([charge("OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA")], "2026-10", {
      selfEmployed: false,
    });
    expect(asked).toEqual([]);
  });

  it("asks someone paid by an employer only what Jane can't name, and never personal or business", () => {
    const unknown = charge("SQ *KITE AND KETTLE 4471", { categorySource: "llm" });
    const asked = uncertainOf(
      [charge("OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA"), unknown],
      "2026-10",
      { selfEmployed: false },
    );
    expect(asked.map((t) => t.description)).toEqual(["SQ *KITE AND KETTLE 4471"]);
    // A September charge nothing names, beside Sam's WeWork (no rule names it) and Adobe (one does).
    const s = run({
      ...paycheckOnly,
      transactions: [
        ...paycheckOnly.transactions,
        {
          date: "2026-09-14",
          amountCents: 4_500,
          description: "BLUEPOINT HOLDINGS 4471",
          pfc: OTHER,
          accountId: paycheckOnly.transactions[0]!.accountId,
        },
      ],
    });
    expect(s?.short).toMatch(
      /^WeWork \$285\.00, Bluepoint Holdings 4471 \$45\.00: I'm not sure what they were\.$/,
    );
    expect(s?.why).not.toMatch(/Adobe/);
    expect(s?.why).toMatch(/so I can't tell what they were\./);
    expect(s?.why).not.toMatch(/personal or a business cost/);
  });

  it("is as it was for someone self-employed: WeWork and Adobe, personal or business", () => {
    const s = run(sam);
    expect(s?.title).toBe("Confirm 2 charges so September 2026 can close");
    expect(s?.short).toMatch(/^WeWork \$285\.00, Adobe \$59\.99/);
    expect(s?.why).toMatch(/personal or a business cost/);
  });
});
