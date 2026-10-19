import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { closeAnsweredElsewhere } from "@/lib/jane-agent/settled";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import {
  CoverChangeError,
  applyCoverEvent,
  coverEvents,
  dismissCoverEvent,
  listCoverChanges,
  prepareCoverChanges,
} from "./cover-changes";
import { latestLife } from "./life";
import { listPolicies } from "./policies";

// Cover changes with life events against a real, migrated Postgres (spec step 154): each
// event (a car, a move, a baby, a marriage, a new job) gets its changes prepared and asked
// about once; nothing changes without the tap the autopilot level needs.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("cover changes with life events against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const opts = () => ({ client, now: NOW });

  async function person(demo = true) {
    const user = await client.user.create({
      data: { email: `ins-change-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (demo) {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: "v1:unused",
        },
      });
    }
    await client.account.create({
      data: {
        userId: user.id,
        source: demo ? "plaid" : "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    return user.id;
  }
  const policy = (userId: string, kind: string, carrier: string, premiumCents: number) =>
    client.insurancePolicy.create({
      data: {
        userId,
        kind,
        carrier,
        source: "typed",
        status: "active",
        premiumCents,
        premiumFrequency: "monthly",
      },
    });
  const lifeEvent = (userId: string, kind: string) =>
    client.lifeEvent.create({
      data: { userId, kind, startedOn: new Date(NOW.getTime() - 3 * DAY) },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("a move: the address on each policy, made on the tap with the same price", async () => {
    const me = await person();
    const renters = await policy(me, "renters", "Lemonade", 1_500);
    const car = await policy(me, "auto", "GEICO", 14_200);
    const event = await lifeEvent(me, "moving");
    expect(await prepareCoverChanges(me, opts())).toBe(2);
    expect(await prepareCoverChanges(me, opts())).toBe(0);
    const prepared = await listCoverChanges(me, opts());
    expect(prepared.map((c) => [c.change, c.policyId, c.status]).sort()).toEqual(
      [
        ["address", renters.id, "prepared"],
        ["address", car.id, "prepared"],
      ].sort(),
    );
    // Asking first (the default): nothing changed yet.
    const made = await applyCoverEvent(me, "moving", event.id, opts());
    expect(made).toHaveLength(2);
    expect(made.every((c) => c.confirmation?.startsWith("DEMO-END-") && c.doneBy === "you")).toBe(
      true,
    );
    expect(
      (await listPolicies(me, opts())).map((p) => p.premiumCents).sort((a, b) => a! - b!),
    ).toEqual([1_500, 14_200]);
  });

  it("a move at 'Everything allowed': Jane updates the address herself", async () => {
    const me = await person();
    await policy(me, "renters", "Lemonade", 1_500);
    await setAutopilot(me, "all", opts());
    await setSectorAutopilot(me, "insurance", { level: "all" }, opts());
    await lifeEvent(me, "moving");
    await prepareCoverChanges(me, opts());
    expect(await listCoverChanges(me, opts())).toMatchObject([
      { change: "address", status: "done", doneBy: "autopilot" },
    ]);
  });

  it("a car: added to the car policy at a new price, only on the tap, even on autopilot", async () => {
    const me = await person();
    const car = await policy(me, "auto", "GEICO", 14_200);
    await setAutopilot(me, "all", opts());
    await setSectorAutopilot(me, "insurance", { level: "all" }, opts());
    const asset = await client.ownedAsset.create({
      data: {
        userId: me,
        kind: "vehicle",
        name: "2024 Honda Civic",
        valueCents: 2_400_000,
        valuedOn: NOW,
      },
    });
    await prepareCoverChanges(me, opts());
    const [change] = await listCoverChanges(me, opts());
    expect(change).toMatchObject({
      event: "car_bought",
      eventKey: asset.id,
      change: "add_vehicle",
      policyId: car.id,
      status: "prepared",
      detail: { vehicle: "2024 Honda Civic" },
    });
    await applyCoverEvent(me, "car_bought", asset.id, opts());
    expect((await listPolicies(me, opts()))[0].premiumCents).toBe(25_600);
  });

  it("a car loan with no car policy: car insurance to get", async () => {
    const me = await person();
    const loan = await client.account.create({
      data: { userId: me, source: "plaid", name: "Auto loan", type: "loan", subtype: "auto" },
    });
    await client.liability.create({
      data: {
        userId: me,
        accountId: loan.id,
        kind: "loan",
        originationDate: new Date(NOW.getTime() - 10 * DAY),
      },
    });
    expect(await coverEvents(me, opts())).toEqual([
      { event: "car_bought", eventKey: loan.id, detail: { vehicle: "the new car" } },
    ]);
    await prepareCoverChanges(me, opts());
    expect((await listCoverChanges(me, opts())).map((c) => c.change)).toEqual(["get_auto"]);
  });

  it("a baby: added to the health plan and the household, and life cover checked", async () => {
    const me = await person();
    await policy(me, "health", "Bluepeak", 40_000);
    const event = await lifeEvent(me, "new_baby");
    await prepareCoverChanges(me, opts());
    expect((await listCoverChanges(me, opts())).map((c) => c.change)).toEqual([
      "add_dependant",
      "review_life",
    ]);
    await applyCoverEvent(me, "new_baby", event.id, opts());
    expect((await listPolicies(me, opts()))[0].premiumCents).toBe(50_000);
    expect((await client.insuranceProfile.findUnique({ where: { userId: me } }))?.dependants).toBe(
      1,
    );
  });

  it("a new job: benefits and life cover to review, nothing with a carrier", async () => {
    const me = await person();
    const event = await lifeEvent(me, "new_job");
    await prepareCoverChanges(me, opts());
    expect((await listCoverChanges(me, opts())).map((c) => c.change)).toEqual([
      "review_benefits",
      "review_life",
    ]);
    await dismissCoverEvent(me, "new_job", event.id, opts());
    await expect(dismissCoverEvent(me, "new_job", event.id, opts())).rejects.toThrow(
      CoverChangeError,
    );
    expect(await prepareCoverChanges(me, opts())).toBe(0);
  });

  it("a marriage told in the chat: the spouse added on one tap, life cover checked", async () => {
    const me = await person();
    await policy(me, "auto", "GEICO", 14_200);
    await client.insuranceProfile.create({ data: { userId: me, dependants: 1 } });
    await client.transaction.create({
      data: {
        userId: me,
        accountId: (await client.account.findFirstOrThrow({ where: { userId: me } })).id,
        source: "plaid",
        date: new Date(NOW.getTime() - 5 * DAY),
        amountCents: -400_000,
        description: "PAYROLL",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_SALARY",
      },
    });
    const { reply } = await sendToJane(me, "we just got married!", opts());
    expect(reply.body.split("\n")).toEqual([
      "Congratulations on getting married! Here's what I've got ready for your insurance:",
      "- Add your spouse to your GEICO car policy",
      "- Check your life cover is still enough",
      "I'll make these with your insurers when you say so, and tell you any new price.",
    ]);
    const ref = reply.refs.coverEvent!;
    expect(ref).toBe("married|told:2026-10-19");

    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const message = (await client.janeMessage.findMany({ where: { userId: me } })).find(
      (m) => parseRefs(m.refs).coverEvent === ref && m.status === "open",
    );
    expect(message).toBeDefined();
    const { message: answered } = await takeChatAction(me, message!.id, "cover.apply", opts());
    expect(answered).toMatchObject({ status: "answered", answeredWith: "Make the changes" });
    expect(parseRefs(answered.refs).note).toBe(
      "Done. Your GEICO car policy is now $185.00 a month. I'll check your life cover next.",
    );
    // Life cover was sized by the review (demo advice).
    expect((await latestLife(me, opts()))?.status).toBe("sized");
    const tool = JSON.parse((await runChatTool(me, "insurance_cover_changes", {}, opts())).content);
    expect(tool.changes).toEqual([
      expect.objectContaining({
        event: "married",
        change: "add_spouse",
        status: "done",
        newPrice: "$185.00",
      }),
      expect.objectContaining({ event: "married", change: "review_life", status: "done" }),
    ]);
  });

  it("without a partner, the person makes the changes and taps Done; Jane never does", async () => {
    const me = await person(false);
    await policy(me, "renters", "Lemonade", 1_500);
    await setAutopilot(me, "all", opts());
    await setSectorAutopilot(me, "insurance", { level: "all" }, opts());
    const event = await lifeEvent(me, "moving");
    await prepareCoverChanges(me, opts());
    // Not even an address, on autopilot: Jane can't reach the carrier.
    expect((await listCoverChanges(me, opts()))[0].status).toBe("prepared");

    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const message = (await client.janeMessage.findMany({ where: { userId: me } })).find(
      (m) => parseRefs(m.refs).coverEvent === `moving|${event.id}`,
    );
    expect(message?.body).toContain("Tell your insurers about these, then tap Done");
    // Done on the page instead: the chat message loses its buttons.
    await applyCoverEvent(me, "moving", event.id, opts());
    expect(await closeAnsweredElsewhere(me, opts())).toBeGreaterThanOrEqual(1);
    expect(
      (await client.janeMessage.findUniqueOrThrow({ where: { id: message!.id } })).status,
    ).toBe("answered");
    expect((await listCoverChanges(me, opts()))[0]).toMatchObject({
      status: "done",
      doneBy: "you",
      confirmation: null,
    });
  });
});
