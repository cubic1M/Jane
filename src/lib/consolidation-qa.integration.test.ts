import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CALENDAR_DAYS } from "@/config/calendar";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addDays } from "@/detection/units";
import { calendarEvents } from "@/lib/calendar";
import { homeSummary } from "@/lib/home";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { ChatActionError } from "@/lib/jane-agent/actions/handler";
import { autopilotAnswer } from "@/lib/jane-agent/insurance/autopilot";
import { chatFeed, stackedSuggestions } from "@/lib/jane-agent/messages";
import { rankedFor } from "@/lib/jane-agent/priorities";
import { byHerself } from "@/lib/jane-agent/replies-autopilot";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { savedToDate } from "@/lib/membership/service";
import { formatCents } from "@/lib/money";
import { monthlyReportFor, renderMonthlyReportEmail } from "@/lib/monthly-report";
import { syncItem } from "@/lib/plaid/sync";
import { autopilotFor } from "@/lib/sector-autopilot";
import { offeredToday, scanSuggestions } from "@/lib/suggestions";
import { startTrial } from "@/lib/trial";

// The consolidation merges (docs/feature-audit.md) on the eight sample people: the first
// Monday of a month, when the brief, the week's line and last month's report all arrive.
// Nothing said twice, the same first thing and the same figures everywhere, and every button
// on what Jane posted still works.

const url = process.env.TEST_DATABASE_URL;
// Linked a week before; then Monday Nov 2, 2026, 8am in Los Angeles: the daily run.
const LINKED = new Date("2026-10-26T16:00:00Z");
const NOW = new Date("2026-11-02T16:00:00Z");
const OPENED = new Date(NOW.getTime() + 60_000);

const firstLine = (body: string) => body.split("\n")[0].trim().toLowerCase();

describe.runIf(url)("the merges, on the eight sample people", { timeout: 240_000 }, () => {
  let client: PrismaClient;
  const made = new Map<string, string>();

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "qa-secret");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE.map((p) => p.id))("%s", async (id) => {
    const found: string[] = [];
    const trial = await startTrial({ client, now: LINKED, defer: true, person: id });
    made.set(id, trial.userId);
    const userId = trial.userId;
    await syncItem(trial.itemId, { client, now: LINKED });
    await runJaneAgent(userId, { client, now: LINKED, trigger: "open" });
    await scanSuggestions(userId, { client, now: NOW });
    await runJaneAgent(userId, { client, now: NOW, trigger: "cron" });

    const { messages } = await chatFeed(userId, { client, now: OPENED });
    const cards = await stackedSuggestions(userId, { client, now: OPENED });
    const shown = [...messages.filter((m) => m.kind !== "user" && m.kind !== "reply"), ...cards];
    const keys = new Map(
      (
        await client.janeMessage.findMany({
          where: { userId },
          select: { id: true, dedupeKey: true },
        })
      ).map((r) => [r.id, r.dedupeKey ?? ""]),
    );
    const sourceOf = (m: { id: string }) => (keys.get(m.id) ?? "").split(":")[0];

    // Nothing said twice: the same opening line, or two messages about one finding.
    const lines = new Map<string, number>();
    for (const m of shown) lines.set(firstLine(m.body), (lines.get(firstLine(m.body)) ?? 0) + 1);
    for (const [line, n] of lines) if (n > 1) found.push(`said ${n} times: "${line}"`);
    const findings = new Map<string, number>();
    for (const m of shown) {
      const f = m.refs.findingId;
      if (f) findings.set(f, (findings.get(f) ?? 0) + 1);
    }
    for (const [f, n] of findings) if (n > 1) found.push(`finding ${f} in ${n} messages`);
    const sources = new Set(shown.map(sourceOf));
    for (const gone of ["week", "review"]) {
      if (sources.has(gone)) found.push(`a "${gone}" message is still posted`);
    }
    // One morning brief (the first-day hello is a brief too).
    const briefs = messages.filter((m) => keys.get(m.id) === "brief:2026-11-02");
    if (briefs.length !== 1) found.push(`${briefs.length} briefs`);

    // The same first thing everywhere.
    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    const ranked = rankedFor(snapshot);
    const offered = await offeredToday(userId, { client, now: NOW });
    if (offered[0] && ranked[0]?.ref !== offered[0].key) {
      found.push(
        `ranked first "${ranked[0]?.title}" but the scan's first is "${offered[0].title}"`,
      );
    }
    // The report keeps what was first when it was made (the sync's run, before the scan here):
    // made again now, it names the same first thing as everything else.
    await client.monthlyReport.deleteMany({ where: { userId } });
    const report = await monthlyReportFor(userId, { client, now: NOW });
    if (!report) found.push("no October report");
    else {
      if ((report.report.next?.title ?? null) !== (ranked[0]?.title ?? null)) {
        found.push(`report next "${report.report.next?.title}" vs ranked "${ranked[0]?.title}"`);
      }
      if (!report.report.summary) found.push("report has no summary");
      const email = renderMonthlyReportEmail(report.report, {
        base: "https://x",
        unsubscribe: "u",
      });
      if (!email.text.includes("Spent:")) found.push("report email has no Spent line");
      // Posted, or a line of the day's agenda (posted hidden behind it).
      const said =
        messages.some((m) => sourceOf(m) === "report") ||
        briefs.some((m) => /money report/i.test(m.body));
      if (!said) found.push("report not said in the chat");
    }

    // The same saved figure on Home and /jane.
    const home = await homeSummary(userId, { client, now: NOW });
    const saved = await savedToDate(userId, { client });
    if (home && home.savedToDateCents !== saved) {
      found.push(`Home saved ${home.savedToDateCents} vs /jane ${saved}`);
    }

    // Safe to spend: the brief says Home's figure.
    const safe = home?.safeToSpend;
    if (
      safe &&
      safe.safeCents >= 0 &&
      !briefs.some((b) => b.body.includes(formatCents(safe.safeCents)))
    ) {
      found.push(`the brief doesn't say Home's safe to spend (${formatCents(safe.safeCents)})`);
    }

    // One alert per charge (cluster 10): a charge is never both "much more than usual" or
    // "charged twice" and an unusual-activity "Was this you?".
    const alerts = await client.alert.findMany({
      where: { userId },
      select: { type: true, key: true },
    });
    const byCharge = new Map<string, string[]>();
    for (const a of alerts) {
      const charge =
        a.type === "large_charge" || a.type === "duplicate_charge"
          ? a.key
          : a.type === "unusual_activity"
            ? a.key.split(":").at(-1)!
            : null;
      if (charge) byCharge.set(charge, [...(byCharge.get(charge) ?? []), a.type]);
    }
    for (const [charge, types] of byCharge) {
      if (types.length > 1) found.push(`charge ${charge} has alerts ${types.join(" + ")}`);
    }

    // The calendar has what Today's coming-up list has.
    const events = await calendarEvents(userId, { client, now: NOW });
    const until = addDays(NOW.toISOString().slice(0, 10), CALENDAR_DAYS);
    for (const row of home?.comingUp ?? []) {
      if (row.date > until) continue;
      if (!events.some((e) => e.date === row.date)) {
        found.push(`Today's "${row.label}" on ${row.date} isn't in the calendar`);
      }
    }

    // Insurance's answer says what its own area allows.
    const area = await autopilotFor(userId, "insurance", { client, now: NOW });
    const answer = await autopilotAnswer(userId, { client });
    if (!answer.body.endsWith(byHerself(area))) found.push("insurance answer ignores its area");

    // Every button on what Jane posted: each one that acts, on a fresh copy of the day.
    for (const m of shown) {
      for (const action of m.actions) {
        if (action.kind === "link") continue;
        try {
          await takeChatAction(userId, m.id, action.id, { client, now: OPENED, defer: () => {} });
        } catch (error) {
          if (error instanceof ChatActionError) continue;
          found.push(`button ${sourceOf(m)}/${action.id} threw: ${String(error).slice(0, 160)}`);
        }
      }
    }

    console.log(`QA ${id}: ${found.length === 0 ? "clean" : `\n  - ${found.join("\n  - ")}`}`);
    expect(found).toEqual([]);
  });
});
