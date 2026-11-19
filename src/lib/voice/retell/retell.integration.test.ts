import { createHmac } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return holder.client;
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/concierge-mode", () => ({
  conciergeMode: vi.fn(async () => true),
  onSampleDataOnly: vi.fn(async () => false),
}));

import { POST } from "@/app/api/voice/retell/route";
import { RETELL } from "@/config/retell";
import { TRIAL_EMAIL_DOMAIN, TRIAL_ID_PREFIX } from "@/config/trial";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { agentStep } from "@/lib/agent/run";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";

// Retell's test calls through the action agent, against a real, migrated Postgres and a fake Retell
// (no network): with VOICE_PROVIDER=retell_test an approved bill negotiation is called through Retell
// at the simulated company's fiction number instead of the simulated job, Retell's signed result
// closes it, and a trial person's call never goes to Retell.

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-retell-key";

describe.runIf(url)("the agent's test calls through Retell", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);
  const retell = vi.fn(async () => Response.json({ call_id: "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6" }));

  async function approved(trial = false) {
    const id = trial ? `${TRIAL_ID_PREFIX}${crypto.randomUUID()}` : undefined;
    const user = await client.user.create({
      data: {
        ...(id ? { id } : {}),
        email: `retell-${crypto.randomUUID()}@${trial ? TRIAL_EMAIL_DOMAIN : "example.com"}`,
        name: "Alex Rivera",
      },
    });
    created.push(user.id);
    const f = findingOfType("bill_negotiation");
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: f.type,
        key: `${f.key}-${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      user.id,
      {
        findingId: finding.id,
        choice: "yes",
        cardHash: cardHash(buildCard(finding)),
        source: "card",
      },
      { client },
    );
    const step = await agentStep(user.id, actionId!, { client, notify });
    return { step, action: await client.action.findUniqueOrThrow({ where: { id: actionId! } }) };
  }
  const simulatedJobs = (actionId: string) =>
    client.job.count({
      where: { kind: "voice_simulated_result", payload: { path: ["actionId"], equals: actionId } },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    holder.client = client;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });
  beforeEach(() => {
    vi.stubEnv(RETELL.switchEnv, RETELL.switchValue);
    vi.stubEnv(RETELL.apiKeyEnv, KEY);
    vi.stubEnv(RETELL.agentIdEnv, "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD");
    vi.stubEnv(RETELL.fromNumberEnv, "+14157774444");
    vi.stubGlobal("fetch", retell);
    retell.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("calls the simulated company's fiction number through Retell, then reads its signed result", async () => {
    const { step, action } = await approved();
    expect(step).toBe("sent");
    expect(action).toMatchObject({ status: "in_progress", agentState: "waiting_reply" });
    expect(retell).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      String((retell.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.to_number).toBe("+12025550100");
    expect(body.metadata).toEqual({ token: action.replyToken });
    expect(await simulatedJobs(action.id)).toBe(0);

    const raw = JSON.stringify({
      event: "call_analyzed",
      call: {
        metadata: { token: action.replyToken },
        transcript: "Agent: Hi.\nCompany: No offers right now.",
        call_analysis: { custom_analysis_data: { outcome: "refused" } },
      },
    });
    const v = Date.now();
    const response = await POST(
      new Request("https://app.example.com/api/voice/retell", {
        method: "POST",
        headers: {
          [RETELL.signatureHeader]: `v=${v},d=${createHmac("sha256", KEY)
            .update(raw + v)
            .digest("hex")}`,
        },
        body: raw,
      }),
    );
    expect(response.status).toBe(200);
    const transcript = await client.agentMessage.findFirstOrThrow({
      where: { actionId: action.id, direction: "inbound" },
    });
    expect(transcript.body).toContain("No offers right now.");
    expect(transcript.summary).toContain("had no offers");
  });

  it("never sends a trial person's call to Retell: the simulated job answers", async () => {
    const { action } = await approved(true);
    expect(retell).not.toHaveBeenCalled();
    expect(await simulatedJobs(action.id)).toBe(1);
  });
});
