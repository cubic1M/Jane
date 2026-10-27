import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { raiseAlerts } from "./alerts";
import { exportUserData } from "./data-export";
import {
  DEADLINE_SOURCES,
  DeadlineError,
  addDeadline,
  deleteDeadline,
  documentDeadlines,
  listDeadlines,
  markDeadlineDone,
  remindAllDeadlines,
  remindDeadlines,
  type DeadlineSource,
} from "./deadlines";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-10-18T12:00:00Z");
const form = (overrides = {}) => ({
  title: "FSA deadline",
  dueOn: "2026-10-20",
  kind: "fsa",
  note: "",
  ...overrides,
});

describe.runIf(url)("deadlines against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  const send = vi.fn();

  async function person(alertPrefs: object = {}) {
    const user = await client.user.create({
      data: { email: `deadlines-${crypto.randomUUID()}@example.com`, alertPrefs },
    });
    ids.push(user.id);
    return user.id;
  }
  const rowsOf = (userId: string) => client.deadline.findMany({ where: { userId } });
  const onlyEntered = (userId: string) =>
    listDeadlines(userId, { client, now: NOW, sources: [DEADLINE_SOURCES[2]] });

  beforeAll(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("adds a deadline the person types in, and checks what they typed", async () => {
    const me = await person();
    await addDeadline(me, form({ title: "  Travel credit  ", kind: "card_benefit" }), {
      client,
      now: NOW,
    });
    const [row] = await rowsOf(me);
    expect(row).toMatchObject({ title: "Travel credit", kind: "card_benefit", note: null });
    expect(row.dueOn.toISOString().slice(0, 10)).toBe("2026-10-20");

    for (const [bad, message] of [
      [{ title: " " }, "Say what the deadline is for."],
      [{ dueOn: "soon" }, "Pick a date."],
      [{ dueOn: "2026-10-17" }, "Pick today or a later date."],
      [{ dueOn: "2040-01-01" }, "Pick a date in the next few years."],
    ] as const) {
      await expect(addDeadline(me, form(bad), { client, now: NOW })).rejects.toThrow(
        new DeadlineError(message),
      );
    }
    // An unknown kind is kept as "other".
    await addDeadline(me, form({ kind: "invest" }), { client, now: NOW });
    expect((await rowsOf(me)).map((r) => r.kind).sort()).toEqual(["card_benefit", "other"]);
  });

  it("keeps each person's deadlines to themselves", async () => {
    const me = await person();
    const other = await person();
    await addDeadline(me, form(), { client, now: NOW });
    const [mine] = await rowsOf(me);

    expect(await onlyEntered(other)).toEqual([]);
    expect(await markDeadlineDone(other, mine.id, { client, now: NOW })).toBe(false);
    expect(await deleteDeadline(other, mine.id, { client })).toBe(false);
    expect((await rowsOf(me))[0].doneAt).toBeNull();
    expect(await onlyEntered(me)).toEqual([
      expect.objectContaining({ title: "FSA deadline", entryId: mine.id, kind: "fsa" }),
    ]);
  });

  it("hides a deadline once done, and deletes one", async () => {
    const me = await person();
    await addDeadline(me, form({ title: "Done one" }), { client, now: NOW });
    await addDeadline(me, form({ title: "Deleted one" }), { client, now: NOW });
    const rows = await rowsOf(me);
    const done = rows.find((r) => r.title === "Done one")!;
    const deleted = rows.find((r) => r.title === "Deleted one")!;

    expect(await markDeadlineDone(me, done.id, { client, now: NOW })).toBe(true);
    expect(await markDeadlineDone(me, done.id, { client, now: NOW })).toBe(false);
    expect(await deleteDeadline(me, deleted.id, { client })).toBe(true);

    expect(await onlyEntered(me)).toEqual([]);
    expect(await rowsOf(me)).toEqual([expect.objectContaining({ id: done.id, doneAt: NOW })]);
  });

  it("is in Download my data", async () => {
    const me = await person();
    await addDeadline(me, form({ note: "Glasses" }), { client, now: NOW });
    const data = await exportUserData(me, { client });
    expect(data.deadlines).toEqual([
      expect.objectContaining({ title: "FSA deadline", kind: "fsa", note: "Glasses" }),
    ]);
  });

  it("brings in every source, and still shows the rest when one fails", async () => {
    const me = await person();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const card: DeadlineSource = async () => [
      {
        key: "doc:1",
        title: "Warranty ends",
        date: "2026-11-01",
        kind: "warranty",
        source: "documents",
        amountCents: null,
        href: null,
        detail: null,
      },
    ];
    const broken: DeadlineSource = async () => {
      throw new Error("down");
    };
    await addDeadline(me, form(), { client, now: NOW });
    const list = await listDeadlines(me, {
      client,
      now: NOW,
      sources: [...DEADLINE_SOURCES, card, broken],
    });
    expect(list.map((d) => d.key)).toEqual([expect.stringMatching(/^entered:/), "doc:1"]);
  });

  it("brings in the dates from the person's uploaded documents, and no one else's", async () => {
    const me = await person();
    const other = await person();
    const upload = (
      userId: string,
      data: Omit<
        Prisma.DocumentUncheckedCreateInput,
        "userId" | "fileName" | "contentType" | "sizeBytes" | "encryptedBytes"
      >,
    ) =>
      client.document.create({
        data: {
          userId,
          fileName: "scan.pdf",
          contentType: "application/pdf",
          sizeBytes: 3,
          encryptedBytes: Buffer.from("v1x"),
          ...data,
        },
      });
    const policy = await upload(me, {
      kind: "insurance_policy",
      provider: "GEICO",
      policyType: "auto",
      renewalDate: new Date("2026-10-20"),
    });
    await upload(me, {
      kind: "receipt",
      provider: "Best Buy",
      purchaseDate: new Date("2026-10-10"),
    });
    await upload(other, {
      kind: "warranty",
      provider: "Dyson",
      warrantyEndsOn: new Date("2026-11-01"),
    });

    expect(await documentDeadlines(other, { client, now: NOW })).toEqual([
      expect.objectContaining({ title: "Dyson warranty ends", kind: "warranty" }),
    ]);
    const list = await listDeadlines(me, { client, now: NOW, sources: [documentDeadlines] });
    expect(list.map((d) => [d.title, d.date, d.kind, d.source])).toEqual([
      ["GEICO car insurance renews", "2026-10-20", "renewal", "documents"],
      ["Return window for Best Buy", "2026-11-09", "return", "documents"],
    ]);

    // The policy's renewal is 2 days away, so it gets a reminder; it has no other.
    const raise = vi.fn(async () => ({ raised: 1, emailed: 0 }));
    await remindDeadlines(me, { client, now: NOW, raise, sources: [documentDeadlines] });
    expect(raise).toHaveBeenCalledWith(
      me,
      [expect.objectContaining({ type: "deadline_soon", key: expect.stringContaining(policy.id) })],
      { client, now: NOW },
    );
  });

  it("finds return windows and due dates from the person's accounts", async () => {
    const me = await person();
    const card = await client.account.create({
      data: { userId: me, source: "csv", name: "Card", type: "credit", subtype: "credit card" },
    });
    await client.liability.create({
      data: {
        userId: me,
        accountId: card.id,
        kind: "credit",
        minimumPaymentCents: 3_500,
        nextPaymentDueDate: new Date("2026-10-25"),
      },
    });
    await client.transaction.create({
      data: {
        userId: me,
        accountId: card.id,
        source: "csv",
        date: new Date("2026-10-16"),
        amountCents: 134_900,
        description: "APPLE STORE R102",
        merchantName: "Apple",
        pfcPrimary: "GENERAL_MERCHANDISE",
        pfcDetailed: "GENERAL_MERCHANDISE_ELECTRONICS",
      },
    });
    const list = await listDeadlines(me, { client, now: NOW });
    expect(list.map((d) => [d.kind, d.date])).toEqual([
      ["payment", "2026-10-25"],
      ["return", "2026-10-30"],
    ]);
  });

  it("reminds once, a few days before, and only if the person wants it", async () => {
    const me = await person();
    const quiet = await person({ deadline_soon: "off" });
    for (const userId of [me, quiet]) {
      await addDeadline(userId, form({ dueOn: "2026-10-20" }), { client, now: NOW });
      await addDeadline(userId, form({ title: "Later", dueOn: "2026-12-01" }), {
        client,
        now: NOW,
      });
    }

    const raise: typeof raiseAlerts = (userId, alerts, options) =>
      raiseAlerts(userId, alerts, { ...options, send });
    expect(await remindDeadlines(me, { client, now: NOW, raise })).toBe(1);
    expect(await remindDeadlines(me, { client, now: NOW, raise })).toBe(0);
    // Emailed by default, like a bill reminder.
    expect(send).toHaveBeenCalledTimes(1);
    const alerts = await client.alert.findMany({ where: { userId: me } });
    expect(alerts).toEqual([
      expect.objectContaining({
        type: "deadline_soon",
        title: expect.stringContaining("FSA deadline"),
      }),
    ]);

    expect(await remindDeadlines(quiet, { client, now: NOW, raise })).toBe(0);
    expect(await client.alert.count({ where: { userId: quiet } })).toBe(0);
  });

  it("runs for everyone with an open deadline in the daily job", async () => {
    const me = await person();
    await addDeadline(me, form(), { client, now: NOW });
    // An open deadline too, but left out of the run (as another test file's person would be).
    const outsider = await person();
    await addDeadline(outsider, form(), { client, now: NOW });
    const done = await person();
    await addDeadline(done, form(), { client, now: NOW });
    await client.deadline.updateMany({ where: { userId: done }, data: { doneAt: NOW } });
    const userIds = [me, done];
    const remind = vi.fn<typeof remindDeadlines>(async () => 1);
    const result = await remindAllDeadlines({ client, now: NOW, remind, userIds });
    expect(remind).toHaveBeenCalledWith(me, { client, now: NOW });
    expect(result).toMatchObject({ users: 1, raised: 1 });
    const reminded = remind.mock.calls.map(([id]) => id);
    expect(reminded).not.toContain(done);
    expect(reminded).not.toContain(outsider);
  });
});
