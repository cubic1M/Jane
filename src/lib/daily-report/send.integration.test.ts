import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { ADVICE_TOPICS } from "@/config/suggestions";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { runDailyReports } from "./send";

// Runs against a real, migrated Postgres (see src/lib/digest/send.integration.test.ts). Other tests
// share the database, so assertions look only at this file's people.
const url = process.env.TEST_DATABASE_URL;
const HOUR = 60 * 60 * 1000;
// 10am on a Monday in California; yesterday was Sunday the 22nd.
const MORNING = new Date("2026-11-23T18:00:00Z");
const at = (iso: string) => new Date(iso);

describe.runIf(url)("runDailyReports against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  const ids: Record<string, string> = {};
  const send = vi.fn();

  async function person(
    name: string,
    opts: {
      daily?: boolean;
      id?: string;
      email?: string;
      spending?: boolean;
      // An uploaded account. Not for the demo-bank person: an upload beside the demo bank is real data.
      upload?: boolean;
    } = {},
  ) {
    const user = await client.user.create({
      data: {
        ...(opts.id ? { id: opts.id } : {}),
        email: opts.email ?? `${name}-${suffix}@example.com`,
        timezone: "America/Los_Angeles",
        ...(opts.daily === undefined ? {} : { dailyReportEnabled: opts.daily }),
      },
    });
    ids[name] = user.id;
    const account =
      opts.upload === false
        ? null
        : await client.account.create({
            data: { userId: user.id, source: "csv", name: "Card", type: "credit" },
          });
    if (opts.spending && account) {
      const buy = (merchant: string, cents: number, key: string) =>
        client.transaction.create({
          data: {
            userId: user.id,
            accountId: account.id,
            source: "csv",
            dedupeKey: `${name}-${key}`,
            date: new Date("2026-11-22"),
            amountCents: cents,
            description: merchant.toUpperCase(),
            merchantName: merchant,
            pfcPrimary: "FOOD_AND_DRINK",
          },
        });
      await buy("Whole Foods", 4_110, "a");
      await buy("Cafe Rio", 1_250, "b");
    }
    return user;
  }

  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("APP_URL", "https://app.example.com");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await person("on", { daily: true, spending: true });
    await person("off", { spending: true });
    await person("trial", {
      daily: true,
      id: `trial_${suffix}`,
      email: `t-${suffix}@try.jane.invalid`,
    });
    const demo = await person("demo", { daily: true, upload: false });
    const item = await client.plaidItem.create({
      data: {
        userId: demo.id,
        plaidItemId: `demo-${suffix}`,
        accessTokenEncrypted: "x",
        institutionName: "Demo Bank",
      },
    });
    await client.account.create({
      data: {
        userId: demo.id,
        source: "plaid",
        itemId: item.id,
        plaidAccountId: `acct-${suffix}`,
        name: "Demo checking",
        type: "depository",
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    send.mockReset();
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
    await client.dailyReport.deleteMany({ where: { userId: ids.on } });
  });

  // A run kept to this file's own people: everyone else in the shared database is another file's.
  const own = () => Object.values(ids);
  const run = (
    now: Date,
    extra: { dryRun?: boolean; userIds?: string[]; budgetMs?: number } = {},
  ) => runDailyReports({ client, userIds: own(), now, send, ...extra });
  const sentTo = () => send.mock.calls.map(([mail]) => mail.to as string);
  const rowsOf = (name: string) => client.dailyReport.findMany({ where: { userId: ids[name] } });

  it("is off for everyone until they turn it on", async () => {
    const fresh = await client.user.create({ data: { email: `fresh-${suffix}@example.com` } });
    ids.fresh = fresh.id;
    expect(fresh.dailyReportEnabled).toBe(false);
    expect(await rowsOf("fresh")).toEqual([]);
  });

  it("sends only to people who turned it on, never a trial person or a demo-bank-only account", async () => {
    const result = await run(MORNING);

    expect(sentTo()).toEqual([`on-${suffix}@example.com`]);
    expect(result).toMatchObject({ sent: 1, failed: 0, excluded: { demo_only: 1 } });
    // The trial person never even reached the run, the one who didn't opt in neither.
    for (const name of ["trial", "off", "demo"]) expect(await rowsOf(name)).toEqual([]);
  });

  it("reviews yesterday from the same lines as the pages, with an unsubscribe in the mail", async () => {
    await run(MORNING);

    const [mail] = send.mock.calls[0];
    expect(mail.subject).toBe("Jane: your daily report, Nov 23");
    expect(mail.text).toContain("Yesterday, Nov 22");
    expect(mail.text).toContain("Your accounts showed 2 purchases totaling $53.60.");
    expect(mail.text).toContain("Largest: Whole Foods $41.10, Cafe Rio $12.50.");
    expect(mail.text).toContain("what=daily");
    expect(mail.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/app\.example\.com\/api\/unsubscribe\?token=.+&what=daily>$/,
    );
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // No address, name or token of anyone in a page link.
    expect(mail.html).not.toContain(`on-${suffix}`);
  });

  it("sends one report a local day, whatever the cron does, and the next day's again", async () => {
    await run(MORNING);
    await run(new Date(MORNING.getTime() + HOUR));
    expect(sentTo()).toHaveLength(1);
    expect(await rowsOf("on")).toMatchObject([{ day: at("2026-11-23"), sentAt: MORNING }]);

    send.mockReset();
    const result = await run(new Date(MORNING.getTime() + 24 * HOUR));
    expect(sentTo()).toEqual([`on-${suffix}@example.com`]);
    expect(result.alreadySent).toBe(0);
    expect(await rowsOf("on")).toHaveLength(2);
  });

  it("sends once when the cron runs twice at the same moment", async () => {
    const both = await Promise.all([run(MORNING), run(MORNING)]);

    expect(sentTo()).toEqual([`on-${suffix}@example.com`]);
    expect(both.map((r) => r.sent).sort()).toEqual([0, 1]);
    expect(await rowsOf("on")).toHaveLength(1);
  });

  it("sends only from 7am to 8pm on their own clock, and a missed hour doesn't use up the day", async () => {
    // Midnight, 6am and 8pm in Los Angeles (winter, UTC-8): outside. Then 7am and 7pm: inside.
    for (const outside of [
      "2026-11-23T08:00:00Z",
      "2026-11-23T14:00:00Z",
      "2026-11-24T04:00:00Z",
    ]) {
      const result = await run(at(outside));
      expect(result.outsideWindow).toBe(1);
    }
    expect(sentTo()).toEqual([]);
    expect(await rowsOf("on")).toEqual([]);

    // The 15:00 UTC cron run reaches Los Angeles in winter: it is 7am there.
    await run(at("2026-11-23T15:00:00Z"));
    expect(sentTo()).toHaveLength(1);
    send.mockReset();
    await client.dailyReport.deleteMany({ where: { userId: ids.on } });
    await run(at("2026-11-24T03:00:00Z"));
    expect(sentTo()).toHaveLength(1);
  });

  // The run has a time budget (the cron's function has 300 seconds): out of it, it stops between
  // people and leaves the rest unclaimed for the next run, and says how many.
  it("stops when its time is used up, leaving people unclaimed for the next run", async () => {
    const result = await run(MORNING, { budgetMs: 0 });
    expect(result).toMatchObject({ sent: 0, deferred: 1 });
    expect(sentTo()).toEqual([]);
    expect(await rowsOf("on")).toEqual([]);

    expect((await run(MORNING)).sent).toBe(1);
  });

  // The email went: a failure to write the audit log or the analytics event afterwards doesn't make it
  // a failure, and doesn't give the day back to be sent twice. The audit write is tried twice and, if
  // it still fails, said in the log: never dropped silently.
  it("counts a delivered report as sent even when the audit log or analytics fail", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(logAudit).mockRejectedValue(new Error("audit down"));
    vi.mocked(track).mockRejectedValue(new Error("analytics down"));

    const result = await run(MORNING);

    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(sentTo()).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(await rowsOf("on")).toMatchObject([{ sentAt: MORNING }]);
    const said = JSON.stringify(logged.mock.calls);
    expect(said).toContain("the audit log entry was not recorded");
    expect(said).toContain("the analytics event was not recorded");
    expect(said).not.toContain(`on-${suffix}@example.com`);

    // And a second run the same day sends nothing: the day is spent, once.
    send.mockReset();
    expect((await run(MORNING)).alreadySent).toBe(1);
    expect(sentTo()).toEqual([]);
  });

  it("gives the day back when sending fails, so the next run tries again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("Resend down"));
    const first = await run(MORNING);
    expect(first.failed).toBe(1);
    expect(await rowsOf("on")).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();

    expect((await run(MORNING)).sent).toBe(1);
  });

  it("writes the audit log and analytics once, with counts and no figures", async () => {
    await run(MORNING);

    expect(logAudit).toHaveBeenCalledTimes(1);
    const [actor, event, target, metadata] = vi.mocked(logAudit).mock.calls[0];
    expect(actor).toEqual({ type: "system", id: null });
    expect(event).toBe("daily_report_sent");
    expect(target).toEqual({ type: "user", id: ids.on });
    expect(metadata).toEqual({
      sections: expect.any(Number),
      busy: expect.any(Boolean),
      suggestions: 0,
    });
    expect(track).toHaveBeenCalledWith(ids.on, "daily_report_sent", metadata);
    expect(JSON.stringify([metadata])).not.toMatch(/53\.60|Whole Foods/);
  });

  it("renders every report without sending or storing anything in a dry run", async () => {
    const result = await run(MORNING, { dryRun: true });

    expect(send).not.toHaveBeenCalled();
    expect(result.previews.map((p) => p.userId)).toEqual([ids.on]);
    expect(await rowsOf("on")).toEqual([]);
  });

  it("lists suggestions new since the last report, and none a real account may not see", async () => {
    const card = (key: string, topic: string, headline: string) =>
      client.suggestion.create({
        data: {
          userId: ids.on,
          key,
          capability: "test",
          topic,
          title: headline,
          headline,
          short: "",
          worthCents: 1_299,
          worthKind: "saves",
          confidencePercent: 84,
          confidenceReason: "seen twice",
          urgency: "later",
          why: "",
          actionLabel: "Look",
          actionHref: "/subscriptions",
          firstSeenAt: new Date("2026-11-22T12:00:00Z"),
        },
      });
    await card(`t1-${suffix}`, "subscription-overlap", "You pay $12.99 a month for Hulu");
    await card(`t2-${suffix}`, "subscription-overlap", "Cancel Hulu to save $12.99 a month");
    await card(`t3-${suffix}`, ADVICE_TOPICS[0], "A fact about a topic that is advice only");

    await run(MORNING);
    const [mail] = send.mock.calls[0];
    expect(mail.text).toContain("New from Jane");
    expect(mail.text).toContain("You pay $12.99 a month for Hulu (84% sure)");
    expect(mail.text).toContain("/subscriptions?utm_source=digest");
    expect(mail.text).not.toMatch(/Cancel Hulu|advice only/);

    // The next day: nothing new since this report, so no such section.
    send.mockReset();
    await run(new Date(MORNING.getTime() + 24 * HOUR));
    expect(send.mock.calls[0][0].text).not.toContain("New from Jane");
    await client.suggestion.deleteMany({ where: { userId: ids.on } });
  });

  // A suggestion first seen after the run's clock but before it reads is not in this report, and is in
  // the next: the report's watermark is the run's clock, so it must not be listed in both.
  it("leaves a suggestion created after the run's clock for the next report", async () => {
    await client.suggestion.create({
      data: {
        userId: ids.on,
        key: `late-${suffix}`,
        capability: "test",
        topic: "subscription-overlap",
        title: "You pay $9.99 a month for Music",
        headline: "You pay $9.99 a month for Music",
        short: "",
        worthCents: 999,
        worthKind: "saves",
        confidencePercent: 70,
        confidenceReason: "seen twice",
        urgency: "later",
        why: "",
        actionLabel: "Look",
        actionHref: "/subscriptions",
        firstSeenAt: new Date(MORNING.getTime() + 1_000),
      },
    });

    await run(MORNING);
    expect(send.mock.calls[0][0].text).not.toContain("Music");

    send.mockReset();
    await run(new Date(MORNING.getTime() + 24 * HOUR));
    expect(send.mock.calls[0][0].text).toContain("You pay $9.99 a month for Music (70% sure)");

    send.mockReset();
    await run(new Date(MORNING.getTime() + 48 * HOUR));
    expect(send.mock.calls[0][0].text).not.toContain("Music");
    await client.suggestion.deleteMany({ where: { userId: ids.on } });
  });

  // A person with a real, linked bank (not the demo bank, no upload), and a way to add its lines.
  async function bankPerson(name: string) {
    const bank = await person(name, { daily: true, upload: false });
    const item = await client.plaidItem.create({
      data: {
        userId: bank.id,
        plaidItemId: `real-${name}-${suffix}`,
        accessTokenEncrypted: "x",
        institutionName: "A real bank",
      },
    });
    const account = await client.account.create({
      data: {
        userId: bank.id,
        source: "plaid",
        itemId: item.id,
        plaidAccountId: `real-acct-${name}-${suffix}`,
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const line = (
      key: string,
      date: string,
      cents: number,
      created: string,
      category: { pfcPrimary: string; pfcDetailed?: string } = { pfcPrimary: "FOOD_AND_DRINK" },
    ) =>
      client.transaction.create({
        data: {
          userId: bank.id,
          accountId: account.id,
          source: "plaid",
          dedupeKey: `${key}-${date}-${suffix}`,
          date: new Date(date),
          amountCents: cents,
          description: key.toUpperCase(),
          merchantName: key,
          ...category,
          createdAt: new Date(created),
        },
      });
    return { bank, line };
  }

  // Jane notices a bill that went up when the charge reaches it, and that can be after the last report
  // even though the charge is dated before it. A change is chosen by whether an earlier report listed
  // it, not by its event date.
  it("lists a change Jane noticed after the last report, though its event is dated before it", async () => {
    const { bank, line } = await bankPerson("noticed");
    const only = { userIds: [bank.id] };
    const music = { pfcPrimary: "ENTERTAINMENT", pfcDetailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" };
    for (const month of ["06", "07", "08", "09", "10"]) {
      await line("Streamly", `2026-${month}-20`, 999, `2026-${month}-20T20:00:00Z`, music);
    }

    await run(MORNING, only);
    expect(send.mock.calls[0][0].text).not.toContain("Streamly went up");
    expect(await client.dailyReport.findMany({ where: { userId: bank.id } })).toMatchObject([
      { changeKeys: [] },
    ]);

    // The bank posts the higher charge on the 23rd evening, dated the 20th: after the first report.
    await line("Streamly", "2026-11-20", 1_499, "2026-11-23T20:00:00Z", music);
    send.mockReset();
    await run(new Date(MORNING.getTime() + 24 * HOUR), only);
    const second = send.mock.calls[0][0].text as string;
    expect(second).toMatch(/Streamly went up from \$9\.99 to \$14\.99 \(\d+% sure\)/);
    const rows = await client.dailyReport.findMany({
      where: { userId: bank.id },
      orderBy: { day: "desc" },
    });
    expect(rows[0].changeKeys).toHaveLength(1);

    // And the day after, with the event still recent, it is not said again.
    send.mockReset();
    await run(new Date(MORNING.getTime() + 48 * HOUR), only);
    expect(send.mock.calls[0][0].text).not.toContain("Streamly went up");
  });

  // The list is short: with five alerts the changes behind them are cut. A report remembers as listed
  // only the changes it really says, so the cut one is in the next report, not lost.
  it("doesn't remember a change the list cut, so the next report says it", async () => {
    const { bank, line } = await bankPerson("cut");
    const only = { userIds: [bank.id] };
    const music = { pfcPrimary: "ENTERTAINMENT", pfcDetailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" };
    for (const month of ["06", "07", "08", "09", "10", "11"]) {
      const cents = month === "11" ? 1_499 : 999;
      await line("Streamly", `2026-${month}-20`, cents, `2026-${month}-20T20:00:00Z`, music);
    }
    // Five alerts raised since the last report fill the "What changed" list.
    for (let i = 1; i <= 5; i += 1) {
      await client.alert.create({
        data: {
          userId: bank.id,
          type: "large_charge",
          key: `cut-${i}-${suffix}`,
          title: `Alert number ${i}`,
          body: "b",
          confidencePercent: 80,
          createdAt: new Date(MORNING.getTime() - i * HOUR),
        },
      });
    }

    await run(MORNING, only);
    const first = send.mock.calls[0][0].text as string;
    expect(first).toContain("Alert number 1 (80% sure)");
    expect(first).not.toContain("Streamly went up");
    expect(await client.dailyReport.findMany({ where: { userId: bank.id } })).toMatchObject([
      { changeKeys: [] },
    ]);

    // The alerts are the first report's now; the change, never said, is the second's.
    send.mockReset();
    await run(new Date(MORNING.getTime() + 24 * HOUR), only);
    const second = send.mock.calls[0][0].text as string;
    expect(second).not.toContain("Alert number");
    expect(second).toMatch(/Streamly went up from \$9\.99 to \$14\.99 \(\d+% sure\)/);

    // And then it is not said again.
    send.mockReset();
    await run(new Date(MORNING.getTime() + 48 * HOUR), only);
    expect(send.mock.calls[0][0].text).not.toContain("Streamly went up");
  });

  // The bank posts a charge a day or two after its date. A line that arrives after one report with
  // an earlier date is listed in the next, once: never in the report it arrived before, never in two.
  it("lists a line the bank posts late in the next report only, and never in two", async () => {
    const { bank, line } = await bankPerson("bank");
    // Sunday the 22nd's charge, and an older one that came in before the first report.
    await line("Sunday", "2026-11-22", 2_000, "2026-11-22T20:00:00Z");
    await line("Early", "2026-11-21", 1_111, "2026-11-23T10:00:00Z");
    const only = { userIds: [bank.id] };

    await run(MORNING, only);
    const first = send.mock.calls[0][0].text as string;
    expect(first).toContain("Your accounts showed 1 purchase totaling $20.00.");
    // The first report has no "last report" to be since.
    expect(first).not.toContain("Posted since your last report");

    // Two days late: dated the 21st, it arrives after the first report went.
    await line("Diner", "2026-11-21", 3_500, "2026-11-23T20:00:00Z");
    await line("Monday", "2026-11-23", 800, "2026-11-23T21:00:00Z");
    send.mockReset();
    await run(new Date(MORNING.getTime() + 24 * HOUR), only);
    const second = send.mock.calls[0][0].text as string;
    expect(second).toContain("Posted since your last report");
    expect(second).toContain("Your bank posted 1 charge totaling $35.00 with earlier dates");
    // Yesterday (the 23rd) is its own day's lines, not the late one; the early one isn't new.
    expect(second).toContain("Your accounts showed 1 purchase totaling $8.00.");
    expect(second).not.toContain("$11.11");

    // And the day after, it is not said again.
    send.mockReset();
    await run(new Date(MORNING.getTime() + 48 * HOUR), only);
    const third = send.mock.calls[0][0].text as string;
    expect(third).not.toContain("Posted since your last report");
    expect(third).not.toContain("$35.00");
    expect(third).not.toContain("$11.11");
  });
});
