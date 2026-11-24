import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addDays } from "@/detection/units";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { storeReply } from "@/lib/jane-agent/messages";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { loadClose } from "@/lib/month-close";
import { scanSuggestions } from "@/lib/suggestions";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// Founder 11-24: Jane doesn't bring last month's close up unasked. It used to reach the dock as a
// card with "Looks right" (#2008: by day two after a first Plaid scan, on day one after an upload);
// now no run posts it, whatever the day, and it waits to be asked. Asked in the chat ("is last
// month closed?"), it answers there with "Looks right", and that tap closes the month.

const url = process.env.TEST_DATABASE_URL;
const DAY1 = new Date("2026-11-17T19:00:00Z");
const DAY2 = new Date("2026-11-18T19:00:00Z");
// When the person looks: the run stamps its messages a few milliseconds after its start.
const LATER = (d: Date) => new Date(d.getTime() + 60_000);

describe.runIf(url)("the month close, never brought up unasked", { timeout: 240_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  // October with one charge in a catch-all category, and three months of pay and groceries.
  async function person(email: string) {
    await client.user.deleteMany({ where: { email } });
    const user = await client.user.create({ data: { email } });
    made.push(user.id);
    const userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    const row = (date: string, description: string, amountCents: number, pfc: string) => ({
      userId,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      description,
      amountCents,
      pfcPrimary: pfc.split("_")[0],
      pfcDetailed: pfc,
    });
    const rows = [row("2026-10-25", "OPENAI *CHATGPT SUBSCR", 2_000, "OTHER_OTHER")];
    for (let week = 0; week < 12; week += 1) {
      const day = addDays("2026-11-14", -7 * week);
      rows.push(
        row(day, "TRADER JOE S #552 OAKLAND CA", 6_000 + week * 31, "FOOD_AND_DRINK_GROCERIES"),
      );
      if (week % 2 === 0)
        rows.push(row(addDays(day, -1), "ACME CORP PAYROLL", -150_000, "INCOME_SALARY"));
    }
    await client.transaction.createMany({ data: rows });
    return userId;
  }
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const closeCard = async (userId: string, now: Date) =>
    (await loadPopupStack(userId, { client, now })).find((m) =>
      m.body.startsWith("Closing October"),
    );
  const closeMessages = (userId: string) =>
    client.janeMessage.count({ where: { userId, body: { startsWith: "Closing October" } } });

  it("is no card in the dock on day one or day two, and asked, its tap closes October", async () => {
    const userId = await person("close-not-in-dock-plaid@example.com");
    // Day one, as a first Plaid sync runs it (src/lib/plaid/sync.ts): suggestions, the early run,
    // then the whole run; day two's run, as the daily job runs it.
    await scanSuggestions(userId, { client, now: DAY1 });
    await runJaneAgent(userId, { client, now: DAY1, trigger: "open", early: true });
    await runJaneAgent(userId, { client, now: DAY1, trigger: "open" });
    expect((await loadClose(userId, { client }))?.status).toBe("waiting");
    expect(await closeCard(userId, LATER(DAY1))).toBeUndefined();
    await runJaneAgent(userId, { client, now: DAY2 });
    expect(await closeCard(userId, LATER(DAY2))).toBeUndefined();
    expect(await closeMessages(userId)).toBe(0);

    // Asked, it answers with "Looks right"; that answer is what one tap closes.
    const reply = (await answerByRules(userId, { kind: "month_close" }, { client, now: DAY2 }))!;
    expect(reply.actions.map((a) => a.label)).toContain("Looks right");
    const asked = await storeReply(userId, reply, { client, at: LATER(DAY2) });
    await takeChatAction(userId, asked.id, "close.confirm", { client, now: LATER(DAY2) });
    expect((await loadClose(userId, { client }))?.status).toBe("closed");
  });

  it("is no card on day one after an upload either", async () => {
    const userId = await person("close-not-in-dock-upload@example.com");
    // An upload's one run (src/lib/import/background.ts).
    await scanSuggestions(userId, { client, now: DAY1 });
    await runJaneAgent(userId, { client, now: DAY1, trigger: "import" });
    expect((await loadClose(userId, { client }))?.status).toBe("waiting");
    expect(await closeCard(userId, LATER(DAY1))).toBeUndefined();
    expect(await closeMessages(userId)).toBe(0);
  });
});
