import { describe, expect, it } from "vitest";
import { buildDigest, changesSince, checkupCounts, type DigestInput } from "./build";

const NOW = new Date("2026-10-19T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const input = (overrides: Partial<DigestInput> = {}): DigestInput => ({
  now: NOW,
  lastSentAt: daysAgo(7),
  moneyFoundCents: 50_000,
  savedToDateCents: 0,
  membershipOffer: false,
  actions: [],
  findings: [],
  alerts: [],
  ...overrides,
});

const action = (overrides: Partial<DigestInput["actions"][number]>) => ({
  status: "done" as const,
  completedAt: daysAgo(2),
  userTodo: null,
  title: "Cancel Hulu",
  annualSavingsCents: 14_388,
  ...overrides,
});

describe("buildDigest", () => {
  it("skips people with nothing new, nothing pending and nothing on their plan", () => {
    expect(buildDigest(input())).toBeNull();
    // An action finished weeks ago isn't news.
    expect(buildDigest(input({ actions: [action({ completedAt: daysAgo(20) })] }))).toBeNull();
  });

  it("sends nothing when nothing changed, even with old findings still on the plan", () => {
    const old = [{ title: "Old", annualSavingsCents: 100, createdAt: daysAgo(30) }];
    expect(buildDigest(input({ findings: old }))).toBeNull();
    // With something new, the plan still counts every open finding.
    const digest = buildDigest(
      input({
        findings: [...old, { title: "New", annualSavingsCents: 50, createdAt: daysAgo(1) }],
      }),
    );
    expect(digest).toMatchObject({ newFindings: [{ title: "New" }], plan: { items: 2 } });
  });

  it("sends for something waiting on the person, but not for work still underway", () => {
    const queued = action({ status: "queued", completedAt: null });
    expect(buildDigest(input({ actions: [queued] }))).toBeNull();
    expect(
      buildDigest(input({ actions: [{ ...queued, status: "waiting_on_user" }] })),
    ).not.toBeNull();
  });

  it("totals what was saved this week, and says the same saved-so-far as /jane", () => {
    const digest = buildDigest(
      input({
        // savedToDate's total (docs/feature-audit.md, cluster 9), not a sum of its own.
        savedToDateCents: 35_976,
        actions: [
          action({}),
          action({ title: "Cancel Netflix", annualSavingsCents: 21_588, completedAt: daysAgo(40) }),
          action({ status: "failed", completedAt: daysAgo(1), annualSavingsCents: 99_999 }),
        ],
      }),
    );

    expect(digest).toMatchObject({
      savedThisWeekCents: 14_388,
      savedToDateCents: 35_976,
      moneyFoundCents: 50_000,
      finishedThisWeek: [{ title: "Cancel Hulu", annualSavingsCents: 14_388 }],
    });
  });

  it("lists pending actions, with what the person must do first", () => {
    const digest = buildDigest(
      input({
        actions: [
          action({ status: "queued", completedAt: null, title: "Fight Netflix price" }),
          action({
            status: "waiting_on_user",
            completedAt: null,
            title: "Refund fees",
            userTodo: "Call your bank",
          }),
        ],
      }),
    );

    expect(digest?.pending).toEqual([
      { title: "Refund fees", status: "waiting_on_user", userTodo: "Call your bank" },
      { title: "Fight Netflix price", status: "queued", userTodo: null },
    ]);
  });

  it("includes findings new since the last digest, or all of them the first time", () => {
    const findings = [
      { title: "New", annualSavingsCents: 100, createdAt: daysAgo(2) },
      { title: "Old", annualSavingsCents: 200, createdAt: daysAgo(30) },
    ];

    expect(buildDigest(input({ findings }))?.newFindings.map((f) => f.title)).toEqual(["New"]);
    expect(
      buildDigest(input({ findings, lastSentAt: null }))?.newFindings.map((f) => f.title),
    ).toEqual(["New", "Old"]);
  });

  it("includes this week's alerts that weren't emailed, and sends for them alone", () => {
    const alerts = [
      { title: "Fee", createdAt: daysAgo(2), emailedAt: null },
      { title: "Emailed already", createdAt: daysAgo(2), emailedAt: daysAgo(2) },
      { title: "Last week", createdAt: daysAgo(9), emailedAt: null },
    ];

    expect(buildDigest(input({ alerts }))?.alerts).toEqual([{ title: "Fee", percent: null }]);
    expect(buildDigest(input({ alerts: alerts.slice(1) }))).toBeNull();
  });

  it("adds budgets near or over their limit, goals, and the week's net worth change", () => {
    const digest = buildDigest(
      input({
        alerts: [{ title: "Fee", createdAt: daysAgo(1), emailedAt: null }],
        plans: {
          budgets: [
            { category: "Food and drink", spentCents: 18_500, budgetCents: 20_000 },
            { category: "Shopping", spentCents: 5_000, budgetCents: 20_000 },
            { category: "Travel", spentCents: 30_000, budgetCents: 20_000 },
          ],
          goals: [{ name: "Trip", percent: 40, savedChangeCents: 10_000 }],
          netWorth: { nowCents: 500_000, weekAgoCents: 480_000 },
        },
      }),
    );
    expect(digest?.budgets).toEqual([
      { category: "Food and drink", spentCents: 18_500, budgetCents: 20_000, over: false },
      { category: "Travel", spentCents: 30_000, budgetCents: 20_000, over: true },
    ]);
    expect(digest?.goals).toEqual([{ name: "Trip", percent: 40, savedChangeCents: 10_000 }]);
    expect(digest?.netWorth).toEqual({ nowCents: 500_000, changeCents: 20_000, notCounting: null });
  });

  // Upload QA: a figure that leaves an account out says so beside it.
  it("carries what net worth leaves out for want of a balance", () => {
    const digest = buildDigest(
      input({
        alerts: [{ title: "Fee", createdAt: daysAgo(1), emailedAt: null }],
        plans: {
          budgets: [],
          goals: [],
          netWorth: {
            nowCents: 500_000,
            weekAgoCents: 480_000,
            notCounting: "not counting card balance",
          },
        },
      }),
    );
    expect(digest?.netWorth?.notCounting).toBe("not counting card balance");
  });

  it("leaves out net worth without last week's snapshot, and still never sends empty", () => {
    expect(
      buildDigest(
        input({
          plans: {
            budgets: [{ category: "Shopping", spentCents: 5_000, budgetCents: 20_000 }],
            goals: [],
            netWorth: { nowCents: 500_000, weekAgoCents: null },
          },
        }),
      ),
    ).toBeNull();
  });

  it("never sends a digest for the membership offer alone", () => {
    expect(buildDigest(input({ membershipOffer: true }))).toBeNull();
  });

  it("never sends for goals, net worth or a near budget alone, only for one gone over", () => {
    const plans = {
      budgets: [{ category: "Food and drink", spentCents: 19_000, budgetCents: 20_000 }],
      goals: [{ name: "Trip", percent: 40, savedChangeCents: 10_000 }],
      netWorth: { nowCents: 500_000, weekAgoCents: 480_000 },
    };
    expect(buildDigest(input({ plans }))).toBeNull();
    const over = { ...plans, budgets: [{ ...plans.budgets[0], spentCents: 21_000 }] };
    expect(buildDigest(input({ plans: over }))?.budgets).toEqual([
      { category: "Food and drink", spentCents: 21_000, budgetCents: 20_000, over: true },
    ]);
  });
});

const change = (overrides: Partial<NonNullable<DigestInput["changes"]>[number]> = {}) => ({
  title: "Comcast went up from $80.00 to $95.00.",
  date: "2026-10-16",
  merchant: "Comcast",
  confidencePercent: 84,
  ...overrides,
});

describe("what changed", () => {
  it("sends for a change alone, each with how sure Jane is", () => {
    const digest = buildDigest(input({ changes: [change()] }));
    expect(digest?.changes).toEqual([
      { title: "Comcast went up from $80.00 to $95.00.", percent: 84 },
    ]);
  });

  it("keeps alerts' confidence, and none on alerts from before it was stored", () => {
    const digest = buildDigest(
      input({
        alerts: [
          {
            title: "Netflix trial may end Oct 22",
            createdAt: daysAgo(1),
            emailedAt: null,
            confidencePercent: 60,
          },
          { title: "Old alert", createdAt: daysAgo(1), emailedAt: null },
        ],
      }),
    );
    expect(digest?.alerts).toEqual([
      { title: "Netflix trial may end Oct 22", percent: 60 },
      { title: "Old alert", percent: null },
    ]);
  });

  it("lists only changes since the last email, or the last week the first time", () => {
    const since = daysAgo(7); // 2026-10-12
    const kept = changesSince(
      [change({ date: "2026-10-13" }), change({ date: "2026-10-12" })],
      [],
      since,
    );
    expect(kept).toHaveLength(1);
    // Someone's first email: the last week's changes only.
    expect(
      buildDigest(input({ lastSentAt: null, changes: [change({ date: "2026-10-01" })] })),
    ).toBeNull();
  });

  it("doesn't say a change twice when an alert says it", () => {
    const changes = [
      change(),
      change({ title: "New $12.00 fee at Chase.", merchant: null, confidencePercent: 70 }),
    ];
    const kept = changesSince(changes, [{ title: "comcast price went up to $95.00" }], daysAgo(7));
    expect(kept.map((c) => c.title)).toEqual(["New $12.00 fee at Chase."]);
  });

  it("puts the surest first and stops at the cap", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      change({ title: `Bill ${i}`, merchant: `M${i}`, confidencePercent: 50 + i }),
    );
    const kept = changesSince(many, [], daysAgo(7));
    expect(kept).toHaveLength(8);
    expect(kept[0]).toEqual({ title: "Bill 11", percent: 61 });
  });

  it("carries read-only mode to the plan", () => {
    const findings = [{ title: "Fees", annualSavingsCents: 100, createdAt: daysAgo(1) }];
    expect(buildDigest(input({ findings, readOnly: true }))?.plan).toEqual({
      items: 1,
      readOnly: true,
    });
    expect(buildDigest(input({ findings }))?.plan).toEqual({ items: 1 });
  });

  it("carries new findings' confidence level", () => {
    const digest = buildDigest(
      input({
        findings: [
          { title: "Fees", annualSavingsCents: 100, createdAt: daysAgo(1), confidence: "high" },
        ],
      }),
    );
    expect(digest?.newFindings).toEqual([
      { title: "Fees", annualSavingsCents: 100, confidence: "high" },
    ]);
  });

  it("sums the checkup, but never sends for the checkup alone", () => {
    const checkup = [
      { status: "found" as const },
      { status: "passed" as const },
      { status: "passed" as const },
      { status: "not_enough_data" as const },
    ];
    expect(checkupCounts(checkup)).toEqual({ checks: 4, found: 1, passed: 2, notEnoughData: 1 });
    expect(checkupCounts([])).toBeNull();
    expect(buildDigest(input({ checkup }))).toBeNull();
    expect(buildDigest(input({ checkup, changes: [change()] }))?.checkup).toEqual({
      checks: 4,
      found: 1,
      passed: 2,
      notEnoughData: 1,
    });
  });
});
