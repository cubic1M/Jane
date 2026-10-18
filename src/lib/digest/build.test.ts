import { describe, expect, it } from "vitest";
import { buildDigest, type DigestInput } from "./build";

const NOW = new Date("2026-10-19T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const input = (overrides: Partial<DigestInput> = {}): DigestInput => ({
  now: NOW,
  lastSentAt: daysAgo(7),
  moneyFoundCents: 50_000,
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
  it("skips people with nothing new and nothing pending", () => {
    expect(buildDigest(input())).toBeNull();
    // An action finished weeks ago and an old finding aren't news.
    expect(
      buildDigest(
        input({
          actions: [action({ completedAt: daysAgo(20) })],
          findings: [{ title: "Old", annualSavingsCents: 100, createdAt: daysAgo(30) }],
        }),
      ),
    ).toBeNull();
  });

  it("totals what was saved this week and to date from finished actions", () => {
    const digest = buildDigest(
      input({
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

    expect(buildDigest(input({ alerts }))?.alerts).toEqual([{ title: "Fee" }]);
    expect(buildDigest(input({ alerts: alerts.slice(1) }))).toBeNull();
  });

  it("never sends a digest for the membership offer alone", () => {
    expect(buildDigest(input({ membershipOffer: true }))).toBeNull();
  });
});
