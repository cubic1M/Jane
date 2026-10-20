import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { RISK_KINDS } from "@/config/insurance";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { closeAnsweredElsewhere } from "@/lib/jane-agent/settled";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadInsurance } from "./profile";
import { RiskError, answerRisk, gapQuotes, listRisks, refreshRisks } from "./risks";

// Risks seen in how they live against a real, migrated Postgres (spec step 197): the demo
// bank has one signal of each kind; each is asked once; a yes opens a gap with sample
// quotes (a new dog adds a pet), and a no is never asked again.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("risks seen in how they live, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const o = () => ({ client, now: NOW });

  async function demoPerson() {
    const user = await client.user.create({
      data: { email: `ins-risk-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("asks one question per kind for the demo bank, once", async () => {
    const me = await demoPerson();
    const risks = await listRisks(me, o());
    expect(risks.map((r) => r.kind).sort()).toEqual([...RISK_KINDS].sort());
    expect(risks.every((r) => r.status === "asked")).toBe(true);
    // Reading again asks nothing new.
    expect(await refreshRisks(me, o())).toEqual([]);
    expect(await client.insuranceRisk.count({ where: { userId: me } })).toBe(6);
  }, 120_000);

  it("a yes opens a gap with sample quotes, a new dog adds a pet, and a no is remembered", async () => {
    const me = await demoPerson();
    const by = async (kind: string) => (await listRisks(me, o())).find((r) => r.kind === kind)!;
    await answerRisk(me, (await by("rideshare")).id, true, o());
    await answerRisk(me, (await by("boat")).id, false, o());
    await answerRisk(me, (await by("new_dog")).id, true, o());
    await expect(answerRisk(me, (await by("boat")).id, true, o())).rejects.toThrow(RiskError);

    const { gaps, household } = await loadInsurance(me, o());
    expect(gaps.map((g) => g.key)).toEqual(expect.arrayContaining(["rideshare", "pet"]));
    expect(gaps.map((g) => g.key)).not.toContain("boat");
    expect(household.pets.value).toBe(1);

    // The no stays a no, however often it's read.
    await refreshRisks(me, o());
    expect((await by("boat")).status).toBe("no");
    expect(await client.insuranceRisk.count({ where: { userId: me, kind: "boat" } })).toBe(1);

    const quotes = await gapQuotes(me, "rideshare", o());
    expect(quotes).toHaveLength(3);
    expect(quotes.every((q) => q.demo && q.annualCents > 0)).toBe(true);
  }, 120_000);

  it("asks in the chat with Yes and No, then shows sample prices on the gap's message", async () => {
    const me = await demoPerson();
    // Jane brings up a few things a day, the most urgent first: look until it comes up.
    const questionOf = async () =>
      (await client.janeMessage.findMany({ where: { userId: me } })).find(
        (m) => m.body.startsWith("Are you driving for Uber?") && m.status === "open",
      );
    let question = await questionOf();
    for (let day = 0; day < 15 && !question; day += 1) {
      await runJaneAgent(me, {
        client,
        now: new Date(NOW.getTime() + day * 86_400_000),
        trigger: "open",
      });
      question = await questionOf();
    }
    expect(question?.body).toBe(
      "Are you driving for Uber? I saw $412.00 come in from Uber Driver on Oct 6. A personal car policy may not cover you while you drive for pay.",
    );
    expect(parseActions(question!.actions).map((a) => a.id)).toEqual(["risk.yes", "risk.no"]);
    const { message } = await takeChatAction(me, question!.id, "risk.yes", o());
    expect(message).toMatchObject({ status: "answered", answeredWith: "Yes" });

    // The gap it opened comes with a Get quotes button; one tap shows three sample prices.
    let gapMessage;
    for (let day = 0; day < 20 && !gapMessage; day += 1) {
      await runJaneAgent(me, {
        client,
        now: new Date(NOW.getTime() + (day + 15) * 86_400_000),
        trigger: "open",
      });
      gapMessage = (await client.janeMessage.findMany({ where: { userId: me } })).find(
        (m) => parseRefs(m.refs).insuranceGap === "rideshare",
      );
    }
    expect(gapMessage?.body).toContain("Your car policy may not cover you while you drive for pay");
    expect(parseActions(gapMessage!.actions).map((a) => a.id)).toContain("insurance.gap_quotes");
    const { message: shown } = await takeChatAction(
      me,
      gapMessage!.id,
      "insurance.gap_quotes",
      o(),
    );
    expect(shown.status).toBe("open");
    expect(shown.body).toContain("Sample prices from my demo carriers:");
    expect(shown.body.split("\n").filter((l) => l.startsWith("- ")).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(parseActions(shown.actions).map((a) => a.id)).not.toContain("insurance.gap_quotes");
  }, 180_000);

  it("closes a chat question answered on the page, and answers and tools say the same", async () => {
    const me = await demoPerson();
    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const risks = await listRisks(me, o());
    const first = (await client.janeMessage.findMany({ where: { userId: me } })).find(
      (m) => parseRefs(m.refs).riskId,
    );
    if (first) {
      await answerRisk(me, parseRefs(first.refs).riskId!, false, o());
      expect(await closeAnsweredElsewhere(me, o())).toBeGreaterThanOrEqual(1);
      expect((await client.janeMessage.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
        "answered",
      );
    }
    const { reply } = await sendToJane(me, "what risks do you see in my insurance", o());
    expect(reply.body.length).toBeGreaterThan(20);
    const tool = JSON.parse((await runChatTool(me, "insurance_risks", {}, o())).content);
    expect(tool.risks).toHaveLength(risks.length);
    expect(tool.risks.map((r: { kind: string }) => r.kind).sort()).toEqual([...RISK_KINDS].sort());
  }, 120_000);
});
