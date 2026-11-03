import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
const jobsDb = vi.hoisted(() => ({ client: undefined as unknown }));
// CI has no default database, so an upload's job goes to this test's, as a real row.
vi.mock("@/lib/jobs", async (importOriginal) => {
  const jobs = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...jobs,
    enqueueJob: (...[kind, payload, options]: Parameters<typeof jobs.enqueueJob>) =>
      jobs.enqueueJob(kind, payload, { client: jobsDb.client as never, ...options }),
  };
});

import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { CONCIERGE_ACTIONS } from "@/config/concierge";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { RATE_LIMITS } from "@/config/rate-limits";
import { STATEMENT_TRIAL_MAX_ROWS, STATEMENT_TRIAL_MAX_UPLOADS } from "@/config/statement-trial";
import { TRIAL_HOURS } from "@/config/trial";
import { deleteAllData } from "@/lib/account-deletion";
import { adviceMode } from "@/lib/advice-mode";
import { mailMode } from "@/lib/agent/mail";
import { recordFact } from "@/lib/memory/facts";
import { canImportCsv, canImportHoldings } from "@/lib/csv-access";
import { conciergeMode } from "@/lib/concierge-mode";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { DecisionError, recordDecision } from "@/lib/decisions";
import { listAccountSummaries } from "@/lib/accounts";
import { scopedFor } from "@/lib/db-scoped";
import { sendEmail } from "@/lib/email";
import { HouseholdError, invitePartner } from "@/lib/household";
import { finishImport } from "@/lib/import/background";
import { saveUpload } from "@/lib/import/upload";
import { hit } from "@/lib/rate-limit";
import { CHAT_PRIMER_TOOLS } from "@/config/agent-chat";
import { chatPrimer, runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { LinkingClosedError, linkAvailability, reserveItemSlot } from "@/lib/plaid/item-slots";
import { DemoBankError, hasDemoBank, linkDemoBank } from "@/lib/plaid/demo";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { runRetention } from "@/lib/retention";
import { callMode } from "@/lib/voice/provider";
import { isSampleTrialUser, isStatementTrialUser, isTrialUser } from "@/lib/trial-ids";
import { cleanUpTrials } from "@/lib/trial";
import { madeUpChaseCsv, madeUpOfx } from "@/lib/__fixtures__/made-up-statement";
import {
  STATEMENT_TRIAL_DELETED,
  STATEMENT_TRIAL_STARTED,
  deleteTrialPerson,
} from "./trial-delete";
import { sessionOwner, startStatementPerson, statementUploadRefusal } from "./statement-trial";

// Trying Jane with your own statement against a real, migrated Postgres: each start is a new
// empty person; two people at once never see each other's rows, through a page's loaders, the
// chat's lookups or a finding's link; it's real data under real-account rules; nothing is left
// once they're gone, checked across every table in the database.

const url = process.env.TEST_DATABASE_URL;
const HOUR = 60 * 60 * 1000;
// Past every other test file's clock: making a sample person clears trial people by age across
// the shared test database, and must not clear these mid-test (debugger 11-02).
const NOW = new Date("2031-03-11T15:00:00Z");

// Every table that isn't reached from users by ON DELETE CASCADE, and why that's right. A new
// table that holds someone's data and doesn't cascade fails the test: add its foreign key, or say
// here why nothing of a person's is in it.
const NOT_A_PERSONS = new Set([
  // Prisma's own, and sign-in links for an address (a temporary person has none).
  "_prisma_migrations",
  "verification_tokens",
  // Handled by deleteTrialPerson: rows naming them go, all but the start and delete records.
  "audit_log",
  "rate_limits",
  "jobs",
  // Hold no person (error_events are scrubbed; a share of merchants is counted without trial people).
  "error_events",
  "saved_replies",
  "merchant_outcomes",
  "cron_runs",
  "health_notices",
  "merchants",
  "switch_options",
  "answer_check_runs",
  "suggestion_kind_stats",
  "refresh_locks",
  "plaid_webhook_events",
  "plaid_item_counter",
  "referral_partners",
  // Market data, and the beta's sign-up lists, by email or code: a temporary person has neither.
  "market_prices",
  "market_history_loads",
  "market_news",
  "news_summary_calls",
  "strategy_evaluations",
  "market_events",
  "market_bars",
  "market_bar_ranges",
  "beta_access",
  "waitlist",
  "invite_codes",
  // Households last past one person. A temporary person can't start one (invitePartner refuses).
  "households",
  "settlements",
  "shared_charges",
]);

async function allTables(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  return rows.map((r) => r.table_name);
}

// Rows in every table that mention this text anywhere, by table.
async function mentions(client: PrismaClient, text: string): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  for (const table of await allTables(client)) {
    if (table === "_prisma_migrations") continue;
    const [row] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "${table}" t WHERE t::text ILIKE $1`,
      `%${text}%`,
    );
    if (Number(row.count) > 0) found[table] = Number(row.count);
  }
  return found;
}

describe.runIf(url)("trying Jane with your own statement", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("RESEND_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    jobsDb.client = client;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const start = async (now = NOW, previous: string | null = null) => {
    const person = await startStatementPerson({ client, now, previous });
    created.push(person.userId);
    return person;
  };

  const form = (name: string, text: string) => {
    const data = new FormData();
    data.set("accountId", "new");
    data.set("new.name", "Made-up checking");
    data.set("new.kind", "checking");
    data.append("files", new File([text], name, { type: "text/csv" }));
    return data;
  };

  // Uploads and runs what the job runs, all the way, as the visitor's upload does.
  const upload = async (userId: string, name: string, text: string, now = NOW) => {
    const saved = await saveUpload(scopedFor(userId, client), form(name, text));
    if (!saved.ok) throw new Error(saved.error);
    await finishImport(userId, saved.runId, { client, now });
    return saved;
  };

  describe("a start", () => {
    it("makes a brand new, empty person with no email, each time", async () => {
      const a = await start();
      const b = await start();
      expect(a.userId).not.toBe(b.userId);
      expect(a.userId).toMatch(/^trial_own_[0-9a-f]{24}$/);
      expect(a.sessionToken).toMatch(/^trial_[0-9a-f]{64}$/);
      expect(a.expires.getTime() - NOW.getTime()).toBe(TRIAL_HOURS * HOUR);
      const db = scopedFor(a.userId, client);
      expect(await db.accounts.count()).toBe(0);
      expect(await db.transactions.count()).toBe(0);
      expect(await db.findings.count()).toBe(0);
      expect(await db.janeMessages.count()).toBe(0);
      expect(await db.plaidItems.count()).toBe(0);
      expect(await client.user.findUniqueOrThrow({ where: { id: a.userId } })).toMatchObject({
        email: `${a.userId}@try.jane.invalid`,
        name: null,
      });
      expect(await sessionOwner(a.sessionToken, { client, now: NOW })).toBe(a.userId);
    });

    it("deletes this browser's last temporary person at once, and only starting again does", async () => {
      const first = await start();
      await upload(first.userId, "first.csv", madeUpChaseCsv("ZZFIRSTSTART", NOW));
      // Looking again changes nothing: only a start resets.
      expect(await sessionOwner(first.sessionToken, { client, now: NOW })).toBe(first.userId);
      expect(await client.user.count({ where: { id: first.userId } })).toBe(1);
      const second = await start(NOW, first.userId);
      expect(await client.user.count({ where: { id: first.userId } })).toBe(0);
      expect(await sessionOwner(first.sessionToken, { client, now: NOW })).toBeNull();
      expect(await mentions(client, "ZZFIRSTSTART")).toEqual({});
      expect(await scopedFor(second.userId, client).transactions.count()).toBe(0);
    });

    it("never deletes a real person, whatever it's given", async () => {
      const real = await client.user.create({
        data: { email: `real-${crypto.randomUUID()}@example.com` },
      });
      created.push(real.id);
      await start(NOW, real.id);
      expect(await client.user.count({ where: { id: real.id } })).toBe(1);
      await expect(deleteTrialPerson(real.id, "start_over", { client })).rejects.toThrow();
      expect(await client.user.count({ where: { id: real.id } })).toBe(1);
    });

    it("stops when a session has ended", async () => {
      const { sessionToken, expires } = await start();
      const later = new Date(expires.getTime() + 1);
      expect(await sessionOwner(sessionToken, { client, now: later })).toBeNull();
      expect(await sessionOwner(undefined, { client })).toBeNull();
    });
  });

  describe("real data under real-account rules", () => {
    let userId: string;
    beforeAll(async () => {
      userId = (await start()).userId;
      await upload(userId, "statement.csv", madeUpChaseCsv("ZZRULES", NOW));
    });

    it("reads a statement into findings, CSV or OFX", async () => {
      const db = scopedFor(userId, client);
      expect(await db.transactions.count()).toBeGreaterThan(20);
      expect(await db.findings.count()).toBeGreaterThan(0);
      const ofx = (await start()).userId;
      await upload(ofx, "statement.ofx", madeUpOfx("ZZOFX", NOW));
      expect(await scopedFor(ofx, client).transactions.count()).toBeGreaterThan(20);
      await client.user.delete({ where: { id: ofx } });
    });

    it("never gets demo advice, here or in production, with or without demo advice on", async () => {
      expect(REAL_ACCOUNT_ADVICE).toBe(false);
      expect(REAL_MONEY_MOVEMENT).toBe(false);
      expect(CONCIERGE_ACTIONS.realAccounts).toBe(false);
      for (const env of ["test", "production"]) {
        vi.stubEnv("NODE_ENV", env);
        vi.stubEnv("DEMO_ADVICE", "1");
        expect(await adviceMode(userId, { client })).toBe(false);
        // Before an upload too: no accounts isn't the demo bank either.
        expect(await adviceMode((await start()).userId, { client })).toBe(false);
      }
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("DEMO_ADVICE", "");
      expect(await hasDemoBank(userId, { client })).toBe(false);
      expect(await moneyPartnerFor(userId, { client })).toBeNull();
    });

    it("isn't the sample person, whatever shares the prefix", () => {
      expect(isTrialUser(userId)).toBe(true);
      expect(isStatementTrialUser(userId)).toBe(true);
      expect(isSampleTrialUser(userId)).toBe(false);
      expect(isSampleTrialUser("trial_0123abcd")).toBe(true);
      expect(isStatementTrialUser("trial_0123abcd")).toBe(false);
      expect(isStatementTrialUser(null)).toBe(false);
      expect(canImportCsv({ id: userId })).toBe(true);
      expect(canImportHoldings({ id: userId })).toBe(false);
      expect(canImportCsv({ id: "trial_0123abcd" })).toBe(false);
    });

    it("gets the do-it-yourself steps for a Yes, and nothing goes to anyone", async () => {
      expect(await conciergeMode(userId, { client })).toBe(false);
      const db = scopedFor(userId, client);
      const finding = await db.findings.findFirstOrThrow({
        where: { type: { in: ["subscription_review", "bank_fees"] } },
        select: { ...CARD_SELECT, status: true },
      });
      const card = buildCard(finding, null);
      const result = await recordDecision(
        userId,
        { findingId: finding.id, choice: "yes", cardHash: cardHash(card) },
        { client, now: NOW },
      );
      expect(result.actionId).toBeNull();
      const decision = await db.decisions.findFirstOrThrow({ where: { findingId: finding.id } });
      expect(decision.choice).toBe("diy");
      expect(await db.actions.count()).toBe(0);
      // No agent job for a Yes, and no simulated company or number in any environment.
      expect(mailMode(userId)).toBe("off");
      expect(callMode(userId)).toBe("off");
      vi.stubEnv("NODE_ENV", "production");
      expect(mailMode(userId)).toBe("off");
      expect(callMode(userId)).toBe("off");
      vi.stubEnv("NODE_ENV", "test");
      const jobs = await client.job.findMany({
        where: { kind: { in: ["agent_step", "agent_simulated_reply", "voice_simulated_result"] } },
        select: { payload: true },
      });
      expect(jobs.filter((j) => (j.payload as { userId?: string }).userId === userId)).toEqual([]);
    });

    it("is never emailed and in no analytics or activity", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test");
      vi.stubEnv("EMAIL_FROM", "jane@example.com");
      const fetch = vi.spyOn(globalThis, "fetch");
      await sendEmail({ to: `${userId}@try.jane.invalid`, subject: "s", html: "h", text: "t" });
      expect(fetch).not.toHaveBeenCalled();
      fetch.mockRestore();
      vi.stubEnv("RESEND_API_KEY", "");
      expect(await client.analyticsEvent.count({ where: { userId } })).toBe(0);
      expect(await client.activityEvent.count({ where: { userId } })).toBe(0);
    });

    it("has bank links, the demo bank and a household off, in any environment", async () => {
      expect(await linkAvailability(userId, { client })).toEqual({ open: false, reason: "trial" });
      await expect(reserveItemSlot(userId, { client })).rejects.toBeInstanceOf(LinkingClosedError);
      vi.stubEnv("DEMO_BANK", "1");
      await expect(linkDemoBank(userId, { client, now: NOW })).rejects.toBeInstanceOf(
        DemoBankError,
      );
      vi.stubEnv("DEMO_BANK", "");
      await expect(
        invitePartner({ id: userId, email: `${userId}@try.jane.invalid` }, "p@example.com", {
          client,
        }),
      ).rejects.toBeInstanceOf(HouseholdError);
      expect(await scopedFor(userId, client).plaidItems.count()).toBe(0);
    });

    it("keeps to the limits on what one person may upload", async () => {
      const db = scopedFor(userId, client);
      const one = [{ bytes: 1000, rows: 10 }];
      expect(await statementUploadRefusal(db, one)).toBeNull();
      expect(await statementUploadRefusal(db, [{ bytes: 2 * 1024 * 1024, rows: 10 }])).toMatch(
        /up to 1 MB/,
      );
      expect(
        await statementUploadRefusal(db, [{ bytes: 1, rows: STATEMENT_TRIAL_MAX_ROWS + 1 }]),
      ).toMatch(/transactions at a time/);
      // And saveUpload holds to them, for any upload on /import too.
      const fresh = await start();
      for (let i = 0; i < STATEMENT_TRIAL_MAX_UPLOADS; i += 1) {
        await scopedFor(fresh.userId, client).importRuns.create({
          data: { userId: fresh.userId, rows: 0 },
        });
      }
      const refused = await saveUpload(
        scopedFor(fresh.userId, client),
        form("more.csv", madeUpChaseCsv("ZZMORE", NOW)),
      );
      expect(refused).toMatchObject({ ok: false });
      expect(await scopedFor(fresh.userId, client).transactions.count()).toBe(0);
    });
  });

  describe("two people at once, each with a different statement", () => {
    const A_MARK = "ZZACORN";
    const B_MARK = "QQBIRCH";
    let a: string;
    let b: string;
    const json = (value: unknown) => JSON.stringify(value).toUpperCase();

    beforeAll(async () => {
      a = (await start()).userId;
      b = (await start()).userId;
      await Promise.all([
        upload(a, "a.csv", madeUpChaseCsv(A_MARK, NOW)),
        upload(b, "b.ofx", madeUpOfx(B_MARK, NOW)),
      ]);
    });

    it("shows each only their own rows, through what pages load", async () => {
      const dbA = scopedFor(a, client);
      const dbB = scopedFor(b, client);
      const [accountsA, accountsB] = await Promise.all([
        listAccountSummaries(dbA),
        listAccountSummaries(dbB),
      ]);
      expect(accountsA.some((x) => accountsB.some((y) => y.id === x.id))).toBe(false);
      const [txA, txB, findingsA, findingsB] = await Promise.all([
        dbA.transactions.findMany({ select: { id: true, description: true } }),
        dbB.transactions.findMany({ select: { id: true, description: true } }),
        dbA.findings.findMany({ select: { id: true, title: true, evidence: true } }),
        dbB.findings.findMany({ select: { id: true, title: true, evidence: true } }),
      ]);
      expect(json(txA)).toContain(A_MARK);
      expect(json(txA)).not.toContain(B_MARK);
      expect(json(txB)).toContain(B_MARK);
      expect(json(txB)).not.toContain(A_MARK);
      expect(json(findingsA)).not.toContain(B_MARK);
      expect(json(findingsB)).not.toContain(A_MARK);
      expect(findingsA.some((x) => findingsB.some((y) => y.id === x.id))).toBe(false);
    });

    it("shows each only their own, through the chat's lookups and its messages", async () => {
      for (const [mine, theirs] of [
        [a, B_MARK],
        [b, A_MARK],
      ]) {
        const primer = await chatPrimer(mine, { client, now: NOW });
        expect(primer.text.toUpperCase()).not.toContain(theirs);
        for (const tool of CHAT_PRIMER_TOOLS) {
          const out = await runChatTool(mine, tool, {}, { client, now: NOW });
          expect(json(out), tool).not.toContain(theirs);
        }
      }
      const reply = await sendToJane(a, `What do I pay ${A_MARK} each month?`, {
        client,
        now: NOW,
      });
      expect(json(reply.reply)).not.toContain(B_MARK);
      const bMessages = await scopedFor(b, client).janeMessages.findMany({
        select: { body: true },
      });
      expect(json(bMessages)).not.toContain(A_MARK);
    });

    it("can't open the other's finding, answer it, or their account", async () => {
      const theirs = await scopedFor(a, client).findings.findFirstOrThrow({
        select: { ...CARD_SELECT, status: true },
      });
      // The finding page's own read: not found, so a 404 (src/app/report/[findingId]/page.tsx).
      expect(
        await scopedFor(b, client).findings.findFirst({ where: { id: theirs.id } }),
      ).toBeNull();
      await expect(
        recordDecision(
          b,
          { findingId: theirs.id, choice: "yes", cardHash: cardHash(buildCard(theirs, null)) },
          { client, now: NOW },
        ),
      ).rejects.toBeInstanceOf(DecisionError);
      expect(
        await scopedFor(b, client).findings.updateMany({
          where: { id: theirs.id },
          data: { status: "declined" },
        }),
      ).toMatchObject({ count: 0 });
      const account = await scopedFor(a, client).accounts.findFirstOrThrow();
      expect(
        await scopedFor(b, client).accounts.findUnique({ where: { id: account.id } }),
      ).toBeNull();
      expect(await scopedFor(b, client).accounts.deleteMany({ where: { id: account.id } })).toEqual(
        { count: 0 },
      );
    });

    it("deleting one leaves the other whole", async () => {
      const before = await scopedFor(b, client).transactions.count();
      await deleteTrialPerson(a, "start_over", { client, now: NOW });
      expect(await scopedFor(b, client).transactions.count()).toBe(before);
      expect(await mentions(client, A_MARK)).toEqual({});
    });
  });

  describe("deleting", () => {
    // Someone who has used everything a visitor can: an upload, findings, a Yes, a chat, memory.
    async function fullPerson(mark: string, now = NOW) {
      const person = await start(now);
      const { userId } = person;
      await upload(userId, `${mark}.csv`, madeUpChaseCsv(mark, now), now);
      const db = scopedFor(userId, client);
      const finding = await db.findings.findFirstOrThrow({
        select: { ...CARD_SELECT, status: true },
      });
      await recordDecision(
        userId,
        { findingId: finding.id, choice: "no", cardHash: cardHash(buildCard(finding, null)) },
        { client, now },
      ).catch(() => undefined);
      await sendToJane(userId, `How much do I spend at ${mark}?`, { client, now });
      await recordFact(
        userId,
        { key: "memory.note", value: `Goes to ${mark}`, label: "A note", source: "answer" },
        { client, now },
      );
      await hit("claudeStatementTrial", userId, { client, now });
      return person;
    }

    it("reaches every table holding a person's data by cascade, or the test says why not", async () => {
      const rows = await client.$queryRaw<{ tbl: string; ref: string; del: string }[]>`
        SELECT cl.relname AS tbl, cf.relname AS ref, con.confdeltype::text AS del
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_class cf ON cf.oid = con.confrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'`;
      const reached = new Set(["users"]);
      for (let grew = true; grew;) {
        grew = false;
        for (const fk of rows) {
          if (fk.del === "c" && reached.has(fk.ref) && !reached.has(fk.tbl)) {
            reached.add(fk.tbl);
            grew = true;
          }
        }
      }
      const missed = (await allTables(client))
        .filter((table) => !reached.has(table) && !NOT_A_PERSONS.has(table))
        .sort();
      expect(missed).toEqual([]);
      // Nothing on the list has come to cascade without the list being tidied.
      expect([...NOT_A_PERSONS].filter((table) => reached.has(table))).toEqual([]);
      // Every user_id column is either in a table that cascades or on the list.
      const columns = await client.$queryRaw<{ table_name: string }[]>`
        SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'user_id'`;
      expect(
        columns.map((c) => c.table_name).filter((t) => !reached.has(t) && !NOT_A_PERSONS.has(t)),
      ).toEqual([]);
    });

    it("leaves nothing of them in any table when they start over", async () => {
      const mark = "ZZDELETEME";
      const { userId } = await fullPerson(mark);
      const db = scopedFor(userId, client);
      // The test is only as good as what was there.
      expect(await db.transactions.count()).toBeGreaterThan(0);
      expect(await db.findings.count()).toBeGreaterThan(0);
      expect(await db.janeMessages.count()).toBeGreaterThan(0);
      expect(await db.importRuns.count()).toBeGreaterThan(0);
      expect(await client.session.count({ where: { userId } })).toBe(1);
      // The file itself is in no table: its header row and its raw lines aren't kept.
      expect(await mentions(client, "Check or Slip")).toEqual({});
      const before = await mentions(client, mark);
      for (const table of ["transactions", "findings", "jane_messages", "import_runs"]) {
        expect(before[table], table).toBeGreaterThan(0);
      }
      expect(await db.userFacts.count()).toBeGreaterThan(0);
      expect(before.user_facts).toBeGreaterThan(0);

      expect(await deleteTrialPerson(userId, "start_over", { client, now: NOW })).toBe(true);

      // Nothing from the statement anywhere, in any table: its merchant's name is in none of them.
      expect(await mentions(client, mark)).toEqual({});
      // Their id: only the two records of the try, in the audit log.
      expect(await mentions(client, userId)).toEqual({ audit_log: 2 });
      const audit = await client.auditLog.findMany({
        where: { targetId: userId },
        orderBy: { createdAt: "asc" },
        select: { event: true, metadata: true, actorId: true },
      });
      expect(audit.map((r) => r.event).sort()).toEqual(
        [STATEMENT_TRIAL_DELETED, STATEMENT_TRIAL_STARTED].sort(),
      );
      // Ids and a reason, nothing from the statement.
      for (const row of audit)
        expect(
          Object.keys(row.metadata as object)
            .sort()
            .join(),
        ).toMatch(/^(reason|terms_version)$/);
    });

    it("goes the same way on the clean-up, once their time is up, and no sooner", async () => {
      const old = new Date(NOW.getTime() - (TRIAL_HOURS + 1) * HOUR);
      const mark = "ZZEXPIRED";
      const expired = await fullPerson(mark, old);
      const fresh = await start(NOW);
      expect(
        await cleanUpTrials({ client, now: NOW, userIds: [expired.userId, fresh.userId] }),
      ).toBe(1);
      expect(await client.user.count({ where: { id: expired.userId } })).toBe(0);
      expect(await client.user.count({ where: { id: fresh.userId } })).toBe(1);
      expect(await mentions(client, mark)).toEqual({});
      const rows = await client.auditLog.findMany({ where: { targetId: expired.userId } });
      expect(rows.find((r) => r.event === STATEMENT_TRIAL_DELETED)?.metadata).toEqual({
        reason: "expired",
      });
    });

    it("goes the same way on the daily retention run", async () => {
      // Long before any other test file's trial people: this run deletes by age, across everyone.
      const now = new Date("2020-02-10T15:00:00Z");
      const old = new Date(now.getTime() - (TRIAL_HOURS + 1) * HOUR);
      const { userId } = await start(old);
      await scopedFor(userId, client).accounts.create({
        data: {
          userId,
          source: "csv",
          name: "ZZRETAINED",
          type: "depository",
          subtype: "checking",
        },
      });
      await runRetention({ client, now });
      expect(await client.user.count({ where: { id: userId } })).toBe(0);
      expect(await mentions(client, "ZZRETAINED")).toEqual({});
    });

    it("goes the same way from Settings' Delete all my data", async () => {
      const mark = "ZZSETTINGS";
      const { userId } = await fullPerson(mark);
      await deleteAllData(userId, { client, api: {} as never });
      expect(await mentions(client, mark)).toEqual({});
      expect(await mentions(client, userId)).toEqual({ audit_log: 2 });
    });

    it("clears the row of a job still running when they went, at the next clean-up", async () => {
      const { userId } = await start();
      const job = await client.job.create({
        data: { kind: "import_finish", payload: { userId }, status: "running" },
      });
      await deleteTrialPerson(userId, "start_over", { client, now: NOW });
      // Still running: it ends by itself as "person gone" (src/lib/jobs.ts).
      expect(await client.job.count({ where: { id: job.id } })).toBe(1);
      await client.job.update({ where: { id: job.id }, data: { status: "done" } });
      await cleanUpTrials({ client, now: NOW, userIds: [] });
      expect(await client.job.count({ where: { id: job.id } })).toBe(0);
      expect(await mentions(client, userId)).toEqual({ audit_log: 2 });
    });

    it("gives the chat counter that would outlive them no way to", async () => {
      expect(RATE_LIMITS.claudeStatementTrial.windowSeconds).toBeGreaterThan(86_400 * 365);
      const { userId } = await start();
      await hit("claudeStatementTrial", userId, { client, now: NOW });
      await deleteTrialPerson(userId, "start_over", { client, now: NOW });
      expect(await client.rateLimit.count({ where: { key: { contains: userId } } })).toBe(0);
    });
  });
});
