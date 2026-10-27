import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { computeBetaMetrics, type BetaRows } from "./beta-metrics";

const user = (id: string, email = `${id}@example.com`, role: "user" | "admin" = "user") => ({
  id,
  email,
  role,
});
const finding = (
  userId: string,
  cents: number | null,
  over: Partial<BetaRows["findings"][0]> = {},
) => ({
  userId,
  type: "bank_fees" as const,
  status: "new" as const,
  confidence: "high" as const,
  annualSavingsCents: cents,
  ...over,
});

const empty: BetaRows = {
  users: [],
  invited: [],
  accounts: [],
  findings: [],
  decisions: [],
  outcomes: [],
};

afterEach(() => vi.unstubAllEnvs());

describe("computeBetaMetrics", () => {
  it("counts real people only: no trial, admin or demo-bank-only people", () => {
    vi.stubEnv("ADMIN_EMAILS", "founder@jane.test");
    const m = computeBetaMetrics({
      ...empty,
      users: [
        user("ana"),
        user("ben"),
        user("trial_x", "x@try.jane.invalid"),
        user("adm", "adm@example.com", "admin"),
        user("fnd", "founder@jane.test"),
        user("demo"),
        user("mixed"),
      ],
      accounts: [
        { userId: "ana", source: "csv", demo: false },
        { userId: "demo", source: "plaid", demo: true },
        { userId: "mixed", source: "plaid", demo: true },
        { userId: "mixed", source: "csv", demo: false },
        { userId: "adm", source: "csv", demo: false },
        { userId: "trial_x", source: "plaid", demo: true },
      ],
      findings: [finding("demo", 50000), finding("adm", 50000), finding("trial_x", 50000)],
    });
    // Ben signed up and hasn't added anything yet: still a real sign-up.
    expect(m.signedUp).toBe(3);
    expect(m.uploaded).toEqual({ users: 2, accounts: 2 });
    expect(m.linked).toEqual({ users: 0, accounts: 0 });
    expect(m.withFinding).toBe(0);
    expect(m.found).toEqual({ users: 2, totalCents: 0, medianCents: 0 });
  });

  it("counts invites without the team's own emails, once per email", () => {
    vi.stubEnv("ADMIN_EMAILS", "founder@jane.test");
    const m = computeBetaMetrics({
      ...empty,
      users: [user("adm", "adm@example.com", "admin")],
      invited: [
        { email: "a@example.com" },
        { email: "b@example.com" },
        { email: "FOUNDER@jane.test" },
        { email: "adm@example.com" },
      ],
    });
    expect(m.invited).toBe(2);
  });

  it("splits accounts by upload and Plaid, leaving demo accounts out", () => {
    const m = computeBetaMetrics({
      ...empty,
      users: [user("ana"), user("ben")],
      accounts: [
        { userId: "ana", source: "csv", demo: false },
        { userId: "ana", source: "csv", demo: false },
        { userId: "ben", source: "plaid", demo: false },
        { userId: "ben", source: "plaid", demo: true },
      ],
    });
    expect(m.uploaded).toEqual({ users: 1, accounts: 2 });
    expect(m.linked).toEqual({ users: 1, accounts: 1 });
  });

  it("adds up $/yr found by the report's rules, keeping findings already done", () => {
    const m = computeBetaMetrics({
      ...empty,
      users: [user("ana"), user("ben"), user("cy")],
      accounts: [
        { userId: "ana", source: "csv", demo: false },
        { userId: "ben", source: "csv", demo: false },
        { userId: "cy", source: "plaid", demo: false },
      ],
      findings: [
        finding("ana", 12000),
        finding("ana", 30000, { status: "done" }),
        // Low confidence and declined findings aren't counted, as on the report.
        finding("ana", 99900, { confidence: "low" }),
        finding("ana", 99900, { status: "declined" }),
        finding("ben", 6000),
        finding("ben", null, { type: "insurance_reshop" }),
      ],
    });
    expect(m.withFinding).toBe(2);
    expect(m.found).toEqual({ users: 3, totalCents: 48000, medianCents: 6000 });
  });

  it("counts people who acted, and verified savings from the outcomes record", () => {
    const m = computeBetaMetrics({
      ...empty,
      users: [user("ana"), user("ben"), user("cy"), user("dee")],
      decisions: [
        { userId: "ana", choice: "yes", undone: false },
        { userId: "ben", choice: "no", undone: false },
        { userId: "cy", choice: "diy", undone: true },
      ],
      outcomes: [
        { userId: "dee", status: "confirmed", confirmedCents: 15000 },
        { userId: "dee", status: "partial", confirmedCents: 2500 },
        { userId: "ana", status: "open", confirmedCents: null },
        { userId: "ben", status: "declined", confirmedCents: null },
      ],
    });
    expect(m.acted).toBe(2);
    expect(m.verified).toEqual({ users: 1, cents: 17500 });
  });
});
