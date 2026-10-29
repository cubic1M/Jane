import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { FOUNDER_NUMBERS } from "@/config/founder-numbers";
import { DAY_MS } from "@/lib/dates";
import {
  computeFounderNumbers,
  copyLine,
  rowsAt,
  snapshot,
  type FounderRows,
  type Snapshot,
} from "./founder-numbers";

const NOW = new Date("2026-10-28T18:00:00Z");
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY_MS - hours * 3.6e6);

const user = (id: string, created = ago(30), over: Partial<FounderRows["users"][0]> = {}) => ({
  id,
  email: `${id}@example.com`,
  role: "user" as const,
  createdAt: created,
  ...over,
});
const account = (userId: string, created = ago(30), demo = false) => ({
  userId,
  source: "csv" as const,
  demo,
  createdAt: created,
});
const finding = (
  userId: string,
  cents: number | null,
  created = ago(29),
  over: Partial<FounderRows["findings"][0]> = {},
) => ({
  id: `f-${userId}-${created.getTime()}-${cents}`,
  userId,
  type: "bank_fees" as const,
  status: "new" as const,
  confidence: "high" as const,
  annualSavingsCents: cents,
  createdAt: created,
  updatedAt: created,
  ...over,
});
const outcome = (userId: string, over: Partial<FounderRows["outcomes"][0]> = {}) => ({
  userId,
  suggestionKey: `s-${userId}-${Math.random()}`,
  status: "open",
  confirmedCents: null,
  createdAt: ago(20),
  doneAt: null,
  verifiedAt: null,
  ...over,
});

const empty: FounderRows = {
  users: [],
  invited: [],
  accounts: [],
  findings: [],
  decisions: [],
  outcomes: [],
  activity: [],
  trialPeople: 0,
};

afterEach(() => vi.unstubAllEnvs());

describe("snapshot", () => {
  it("counts real people only, leaving trial, team, founders' and demo-only accounts out", () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@jane.test");
    vi.stubEnv("FOUNDER_EMAILS", "me@gmail.test, Other@Gmail.test");
    const rows: FounderRows = {
      ...empty,
      users: [
        user("ana"),
        user("ben"),
        user("trial_x"),
        user("adm", ago(30), { role: "admin" }),
        user("env", ago(30), { email: "admin@jane.test" }),
        user("me", ago(30), { email: "me@gmail.test" }),
        user("other", ago(30), { email: "other@gmail.test" }),
        user("demo"),
      ],
      accounts: [
        account("ana"),
        account("me"),
        account("other"),
        account("demo", ago(30), true),
        account("trial_x", ago(30), true),
      ],
      findings: [finding("ana", 12000), finding("me", 99900), finding("demo", 99900)],
      trialPeople: 4,
    };
    const s = snapshot(rows, NOW);
    expect(s.signedUp).toBe(2);
    expect(s.added).toBe(1);
    expect(s.withFinding).toBe(1);
    expect(s.foundMedianCents).toBe(12000);

    const all = computeFounderNumbers(rows, NOW);
    // The trial person in the rows plus the ones counted apart.
    expect(all.excluded).toEqual({ trial: 5, team: 4, demoOnly: 1 });
  });

  it("gives the median and the mean found per person who added an account", () => {
    const s = snapshot(
      {
        ...empty,
        users: [user("ana"), user("ben"), user("cy"), user("dee")],
        accounts: [account("ana"), account("ben"), account("cy")],
        findings: [
          finding("ana", 10000),
          finding("ben", 20000),
          finding("ben", 40000, ago(28), { status: "done" }),
          // dee added nothing, so dee isn't in the per-person numbers.
          finding("dee", 50000),
        ],
      },
      NOW,
    );
    expect(s.added).toBe(3);
    // ana 10000, ben 60000, cy 0.
    expect(s.foundMedianCents).toBe(10000);
    expect(s.foundMeanCents).toBe(23333);
  });

  it("has no per-person found numbers before anyone added an account", () => {
    const s = snapshot({ ...empty, users: [user("ana")] }, NOW);
    expect(s.foundMedianCents).toBeNull();
    expect(s.foundMeanCents).toBeNull();
    expect(s.medianMsToFirstFinding).toBeNull();
  });

  it("counts fixes marked done once, from the record or a finished finding", () => {
    const done = finding("ana", 5000, ago(25), { id: "f1", status: "done", updatedAt: ago(10) });
    const teamDone = finding("ana", 7000, ago(25), {
      id: "f2",
      status: "done",
      updatedAt: ago(9),
    });
    const s = snapshot(
      {
        ...empty,
        users: [user("ana"), user("adm", ago(30), { role: "admin" })],
        accounts: [account("ana")],
        findings: [done, teamDone, finding("adm", 1, ago(25), { status: "done" })],
        outcomes: [
          // The DIY card's record: the same fix as finding f1.
          outcome("ana", { suggestionKey: "finding:f1", doneAt: ago(10) }),
          outcome("ana", { doneAt: ago(5) }),
          // Shown but never done.
          outcome("ana"),
          outcome("adm", { doneAt: ago(5) }),
        ],
      },
      NOW,
    );
    expect(s.fixesDone).toBe(3);
  });

  it("adds verified savings from the record, confirmed or partial, above zero", () => {
    const s = snapshot(
      {
        ...empty,
        users: [user("ana"), user("ben")],
        outcomes: [
          outcome("ana", { status: "confirmed", confirmedCents: 15000, verifiedAt: ago(3) }),
          outcome("ana", { status: "partial", confirmedCents: 2500, verifiedAt: ago(2) }),
          outcome("ben", { status: "confirmed", confirmedCents: 0, verifiedAt: ago(2) }),
          outcome("ben", { status: "open", confirmedCents: null }),
        ],
      },
      NOW,
    );
    expect(s.verified).toEqual({ people: 1, cents: 17500 });
  });

  it("counts weekly active real people from the activity log's last 7 days", () => {
    const s = snapshot(
      {
        ...empty,
        users: [user("ana"), user("ben"), user("cy"), user("adm", ago(30), { role: "admin" })],
        activity: [
          { userId: "ana", at: ago(0, 2) },
          { userId: "ana", at: ago(1) },
          { userId: "ben", at: ago(FOUNDER_NUMBERS.activeDays - 1) },
          // Too long ago.
          { userId: "cy", at: ago(FOUNDER_NUMBERS.activeDays, 1) },
          { userId: "adm", at: ago(0, 1) },
        ],
      },
      NOW,
    );
    expect(s.weeklyActive).toBe(2);
  });

  it("takes the median time from sign-up to each person's first finding", () => {
    const s = snapshot(
      {
        ...empty,
        users: [user("ana", ago(10)), user("ben", ago(10)), user("cy", ago(10)), user("dee")],
        accounts: [account("ana"), account("ben"), account("cy")],
        findings: [
          finding("ana", 100, ago(10, -1)),
          finding("ana", 100, ago(9)),
          finding("ben", 100, ago(8)),
          finding("cy", 100, ago(10, -3)),
        ],
      },
      NOW,
    );
    // 1 hour, 3 hours and 2 days: the middle one is 3 hours.
    expect(s.medianMsToFirstFinding).toBe(3 * 3.6e6);
  });
});

describe("rowsAt", () => {
  it("keeps what existed by then, done and verified only if by then", () => {
    const rows: FounderRows = {
      ...empty,
      users: [user("ana", ago(10)), user("ben", ago(2))],
      outcomes: [
        outcome("ana", {
          createdAt: ago(9),
          status: "confirmed",
          confirmedCents: 5000,
          doneAt: ago(8),
          verifiedAt: ago(1),
        }),
        // Verified before the date was kept: counted from when it was made.
        outcome("ana", { createdAt: ago(9), status: "confirmed", confirmedCents: 100 }),
      ],
      activity: [{ userId: "ana", at: ago(1) }],
    };
    const then = rowsAt(rows, ago(5));
    expect(then.users.map((u) => u.id)).toEqual(["ana"]);
    expect(then.outcomes.map((o) => [o.status, o.doneAt])).toEqual([
      ["open", ago(8)],
      ["confirmed", null],
    ]);
    expect(then.activity).toEqual([]);
    expect(snapshot(rows, ago(5)).verified).toEqual({ people: 1, cents: 100 });
    expect(snapshot(rows, NOW).verified).toEqual({ people: 1, cents: 5100 });
  });
});

describe("computeFounderNumbers", () => {
  it("has one snapshot per day for the trend, the last one being now", () => {
    const n = computeFounderNumbers(
      {
        ...empty,
        users: [user("ana", ago(10)), user("ben", ago(3)), user("cy", ago(0, 1))],
      },
      NOW,
    );
    expect(n.trend).toHaveLength(FOUNDER_NUMBERS.trendDays + 1);
    expect(n.trend.map((s) => s.signedUp)).toEqual([1, 1, 1, 1, 2, 2, 2, 3]);
    expect(n.now).toBe(n.trend[n.trend.length - 1]);
    expect(n.copyLine).toBe(copyLine(n.now));
  });
});

describe("copyLine", () => {
  const base: Snapshot = {
    signedUp: 14,
    added: 12,
    withFinding: 10,
    foundMedianCents: 38049,
    foundMeanCents: 41000,
    fixesDone: 6,
    verified: { people: 0, cents: 0 },
    weeklyActive: 9,
    medianMsToFirstFinding: 60_000,
  };

  it("is built from the same numbers", () => {
    expect(copyLine(base)).toBe("14 beta users · $380/yr found per person · 6 fixes made");
  });

  it("says verified savings once there are some, and gets the singulars right", () => {
    expect(
      copyLine({ ...base, signedUp: 1, fixesDone: 1, verified: { people: 1, cents: 12000 } }),
    ).toBe("1 beta user · $380/yr found per person · 1 fix made · $120 verified saved");
  });

  it("leaves out found per person until someone has added an account", () => {
    expect(copyLine({ ...base, signedUp: 0, foundMedianCents: null, fixesDone: 0 })).toBe(
      "0 beta users · 0 fixes made",
    );
  });
});
