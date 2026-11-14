import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "./build";
import { inputFor } from "./sample";
import { stoppedEmployer } from "./stopped-employer";

// Debugger 11-14, from the simplify pass: "has this paycheck stopped?" was worked out by the profile
// keyed by employerName and by the tax estimate keyed by payerKeyOf. A bank that puts the deposit's
// date on each paycheck ("DIRECT DEP SPRINGFIELD SCHOOLS 102025") made every paycheck its own
// employer in the profile: the sample family read as six earners working for "SPRINGFIELD SCHOOLS
// 090526", while the tax estimate saw one payer still paying. Both now read one rule
// (./stopped-payers.ts).

const family = inputFor("family");
const dated = {
  ...family,
  transactions: family.transactions.map((t) =>
    t.pfc === "INCOME_SALARY"
      ? {
          ...t,
          description: `DIRECT DEP ${t.description.replace(/ PAYROLL.*/, "")} ${t.date.slice(5, 7)}${t.date.slice(8, 10)}${t.date.slice(2, 4)}`,
        }
      : t,
  ),
};

describe("paychecks with the deposit's date on each one", () => {
  it("are one employer, as without the date", () => {
    const plain = buildProfile(family).facts;
    const facts = buildProfile(dated).facts;
    expect(facts.earners.value).toBe(plain.earners.value);
    expect(facts.employer.value).toBe("SPRINGFIELD SCHOOLS");
    expect(facts.monthly_income.value).toBe(plain.monthly_income.value);
  });

  it("aren't a stopped job while the pay keeps coming", () => {
    expect(stoppedEmployer(dated)).toBeNull();
  });
});
