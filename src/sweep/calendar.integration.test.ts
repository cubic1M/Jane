import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The area loaders read the default client: the test database here.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PERSON_IDS } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { NO_PLAID } from "@/lib/__fixtures__/plaid";
import { syncItem } from "@/lib/plaid/sync";
import { refreshPrimer } from "@/lib/jane-agent/claude-tools";
import { scanSuggestions } from "@/lib/suggestions";
import { addDays } from "@/detection/units";
import { STALE_AFTER_DAYS } from "@/profile/build";
import { atLocal, changes, daysFrom, unexplained, type Change, type Flat } from "./diff";
import { dockDoubles } from "./invariants";
import { DATED } from "./reasons";
import { makePerson, UPLOADS, type OwnRows, type Who } from "./__fixtures__/people";
import { snapshotAt } from "./snapshot";

// Gate C (mvp-ready.md): nothing a person sees moves with the calendar for no reason. For the demo
// person, each sample person and someone who uploaded a statement, with their data held fixed, everything they see is read at 3pm
// and 7pm Pacific on every day for two months (DST's end, month ends, the 1st and the 15th, the
// year's end), plus a week around DST's start and one around a leap day. Two ways:
// - frozen: one sync on the day they link, then only the clock moves. A change from one day to the
//   next must have a reason the sweep names (src/sweep/reasons.ts); 7pm must equal 3pm. An upload
//   is frozen only, and compared from its first day: no new line can come, so nothing waits.
// - daily: a sync each morning (data through yesterday, as for anyone with a bank), so paydays
//   and month ends land in the data, the nightly scan for suggestions after it, and a scan again
//   at 7pm, as a sync landing then runs. 7pm must equal 3pm.
// Slow (about a second a moment), so it runs nightly, not on each pull request:
//   CALENDAR_SWEEP=1 npx vitest run src/sweep/calendar.integration.test.ts
// Narrow it with SWEEP_PEOPLE=demo,renter SWEEP_WINDOWS=main SWEEP_MODES=frozen SWEEP_FROM=2026-11-30 SWEEP_DAYS=7, and
// SWEEP_DUMP=1 writes every value at both hours, a file a day, for looking into a finding.
// The report (every 7pm/3pm difference and every unexplained change) goes to SWEEP_OUT
// (default the system temp folder, jane-calendar-sweep/). No Claude: no key, and the chat's questions go to its rules.

const url = process.env.TEST_DATABASE_URL;
const on = Boolean(url) && process.env.CALENDAR_SWEEP === "1";
const ZONE = "America/Los_Angeles";
// A fixed seed for each person, window and mode, so every run sees the same amounts (and two
// people never share a bank's account ids).
const seedOf = (...parts: string[]) =>
  createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 16);

type Window = { name: string; linked: string; first: string; last: string };
const WINDOWS: Window[] = [
  // Two months: DST ends Nov 1, Nov 15, Nov 30, Dec 1, Dec 31, Jan 1.
  { name: "main", linked: "2026-10-25", first: "2026-10-25", last: "2027-01-01" },
  // Linked 40 days ahead, so these weeks are read with the data past STALE_AFTER_DAYS too.
  { name: "dst-start", linked: "2027-01-28", first: "2027-03-09", last: "2027-03-17" },
  { name: "leap-day", linked: "2028-01-15", first: "2028-02-24", last: "2028-03-03" },
];
type Mode = "frozen" | "daily";

const listed = (name: string) =>
  process.env[name]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const people: Who[] = (listed("SWEEP_PEOPLE") as Who[]) ?? [
  "demo",
  ...PERSON_IDS,
  "upload",
  "two-uploads",
  "mid-start",
];
const windows = WINDOWS.filter((w) => listed("SWEEP_WINDOWS")?.includes(w.name) ?? true);
const modes = (listed("SWEEP_MODES") as Mode[]) ?? ["frozen", "daily"];
const dayCap = Number(process.env.SWEEP_DAYS ?? Infinity);
const from = process.env.SWEEP_FROM ?? "";
const outDir = process.env.SWEEP_OUT ?? `${tmpdir()}/jane-calendar-sweep`;

type Finding = { person: string; mode: Mode; window: string; day: string; kind: string } & Change;

describe.runIf(on)("the calendar sweep (gate C)", () => {
  let client: PrismaClient;
  const made: string[] = [];
  const found: Finding[] = [];
  const timings: number[] = [];

  // The test's own rows, written here so they go through the database's owner
  // (./__fixtures__/people.ts).
  const own = (): OwnRows => ({
    person: (data) => client.user.create({ data }),
    token: (id, accessTokenEncrypted) =>
      client.plaidItem.update({ where: { id }, data: { accessTokenEncrypted } }),
  });

  beforeAll(() => {
    stubTestKeys();
    vi.stubEnv("SYNC_SNAPSHOTS", "off");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterAll(async () => {
    vi.useRealTimers();
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      `${outDir}/calendar-sweep.json`,
      JSON.stringify({ people, windows, modes, timings: summary(timings), found }, null, 1),
    );
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  // A person with their bank linked on `day` (at 8am there) and its first sync done, or with a
  // statement through that day uploaded then (./__fixtures__/people.ts).
  async function person(who: Who, day: string, seed: string) {
    const linked = atLocal(day, 8, ZONE);
    vi.setSystemTime(linked);
    const made_ = await makePerson(client, own(), who, {
      linked,
      seed,
      email: `sweep-${who}-${day}-${made.length}@example.test`,
      timezone: ZONE,
    });
    made.push(made_.userId);
    return made_;
  }

  async function read(userId: string, now: Date): Promise<Flat> {
    vi.setSystemTime(now);
    const started = performance.now();
    const snap = await snapshotAt(userId, { client, now });
    timings.push(performance.now() - started);
    return snap;
  }

  for (const who of people) {
    for (const window of windows) {
      for (const mode of modes.filter((m) => !UPLOADS.has(who) || m === "frozen")) {
        it(
          `${who}, ${window.name}, ${mode}: the same at 7pm as at 3pm, and nothing moves for no reason`,
          { timeout: 3_600_000 },
          async () => {
            const { userId, itemId } = await person(
              who,
              window.linked,
              seedOf(who, window.name, mode),
            );
            const days = daysFrom(window.first, window.last)
              .filter((d) => d >= from)
              .slice(0, dayCap);
            // Frozen data is compared day to day once it's past STALE_AFTER_DAYS (src/profile/build.ts):
            // before that, "the last 12 months" and its kin end at today by design, as for anyone
            // whose bank is current. After it they end at the data, and only what's dated may move.
            // The person's own dates, for the reasons that fall on one of them.
            const newest = await client.transaction.findFirst({
              where: { userId },
              orderBy: { date: "desc" },
              select: { date: true },
            });
            const perAccount = await client.transaction.groupBy({
              by: ["accountId"],
              where: { userId },
              _max: { date: true },
            });
            const dates = {
              linked: window.linked,
              lastLine: newest ? newest.date.toISOString().slice(0, 10) : "",
              accountsLast: perAccount.flatMap((a) =>
                a._max.date ? [a._max.date.toISOString().slice(0, 10)] : [],
              ),
            };
            const stale = UPLOADS.has(who)
              ? window.linked
              : addDays(window.linked, STALE_AFTER_DAYS + 1);
            let yesterday: Flat | null = null;
            const mine: Finding[] = [];
            for (const day of days) {
              if (mode === "daily" && itemId && day !== window.linked) {
                const morning = atLocal(day, 8, ZONE);
                vi.setSystemTime(morning);
                await syncItem(itemId, { client, api: NO_PLAID, now: morning });
                // The nightly scan, which runs before the person's day starts, and the chat's
                // numbers saved after it (src/lib/controller.ts, its suggestions step).
                await scanSuggestions(userId, { client, now: morning });
                await refreshPrimer(userId, { client, now: morning });
              }
              const afternoon = await read(userId, atLocal(day, 15, ZONE));
              // The day's picks stay the day's (debug 3, 11-16: on UTC's day a scan at 4pm in Los
              // Angeles chose tomorrow's).
              if (mode === "daily" && itemId) {
                const scanned = atLocal(day, 19, ZONE);
                vi.setSystemTime(scanned);
                await scanSuggestions(userId, { client, now: scanned });
              }
              const evening = await read(userId, atLocal(day, 19, ZONE));
              // For looking into a finding: every value at both hours, one file a day.
              if (process.env.SWEEP_DUMP === "1") {
                mkdirSync(`${outDir}/dump`, { recursive: true });
                writeFileSync(
                  `${outDir}/dump/${who}-${window.name}-${mode}-${day}.json`,
                  JSON.stringify({ afternoon, evening }, null, 1),
                );
              }
              for (const c of changes(afternoon, evening)) {
                mine.push({
                  person: who,
                  mode,
                  window: window.name,
                  day,
                  kind: "7pm vs 3pm",
                  ...c,
                });
              }
              // Each morning's sync posts what it found at once (the 24/7 engine, src/lib/live/
              // arrivals.ts): the dock keeps one card a merchant through it (#2153).
              if (mode === "daily") {
                for (const path of [...dockDoubles(afternoon), ...dockDoubles(evening)])
                  mine.push({
                    person: who,
                    mode,
                    window: window.name,
                    day,
                    kind: "one merchant, two dock cards",
                    path,
                    before: undefined,
                    after: undefined,
                  });
              }
              if (mode === "frozen" && yesterday && day > stale) {
                for (const c of unexplained(day, changes(yesterday, afternoon), DATED, dates, {
                  before: yesterday,
                  after: afternoon,
                })) {
                  mine.push({
                    person: who,
                    mode,
                    window: window.name,
                    day,
                    kind: "day to day",
                    ...c,
                  });
                }
              }
              yesterday = afternoon;
            }
            found.push(...mine);
            expect(
              mine.map(
                (f) => `${f.day} ${f.kind} ${f.path}: ${String(f.before)} → ${String(f.after)}`,
              ),
            ).toEqual([]);
          },
        );
      }
    }
  }
});

function summary(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (q: number) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
  return {
    moments: ms.length,
    p50: at(0.5),
    p95: at(0.95),
    totalSeconds: Math.round(ms.reduce((a, b) => a + b, 0) / 1000),
  };
}
