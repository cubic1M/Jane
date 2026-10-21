import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { closeAnsweredElsewhere } from "@/lib/jane-agent/settled";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { listPolicies } from "./policies";
import { SavingError, applySaving, dismissSaving, listSavings, refreshSavings } from "./savings";

// Paying less for the same cover against a real, migrated Postgres (spec step 196): the
// savings found for a demo-bank person, shown with their yearly figures, made only on the
// person's tap through the partner stand-in; the cover stays the same except for a higher
// deductible, which is its own tap.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");
const opts = () => ({ client: undefined as never, now: NOW });

describe.runIf(url)("paying less for the same cover, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const o = () => ({ ...opts(), client });

  async function person(demo = true) {
    const user = await client.user.create({
      data: { email: `ins-save-${crypto.randomUUID()}@example.com` },
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
        name: "Savings",
        type: "depository",
        subtype: "savings",
        currentBalanceCents: 2_800_000,
      },
    });
    const policy = await client.insurancePolicy.create({
      data: {
        userId: user.id,
        kind: "auto",
        carrier: "GEICO",
        source: "typed",
        status: "active",
        premiumCents: 14_200,
        premiumFrequency: "monthly",
        deductibleCents: 100_000,
      },
    });
    return { userId: user.id, policyId: policy.id };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("finds the savings for a demo-bank person, and none for a real account", async () => {
    const me = await person();
    const offered = await refreshSavings(me.userId, o());
    expect(offered.map((s) => [s.kind, s.yearlySavingCents])).toEqual([
      ["telematics", 17_040],
      ["higher_deductible", 17_040],
      ["pay_in_full", 13_320],
      ["autopay", 5_112],
      ["paperless", 3_408],
    ]);
    // Refreshing again changes nothing.
    expect((await refreshSavings(me.userId, o())).length).toBe(5);
    const real = await person(false);
    expect(await refreshSavings(real.userId, o())).toEqual([]);
  });

  it("applies one on the tap through the partner: the policy changes, and is not offered again", async () => {
    const me = await person();
    const [pay] = (await refreshSavings(me.userId, o())).filter((s) => s.kind === "pay_in_full");
    const done = await applySaving(me.userId, pay.id, o());
    expect(done).toMatchObject({ status: "applied", yearlySavingCents: 13_320 });
    expect(done.confirmation).toMatch(/^DEMO-SAV-/);
    expect((await listPolicies(me.userId, o()))[0]).toMatchObject({
      premiumFrequency: "yearly",
      premiumCents: 157_080,
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: me.userId },
      "insurance_saving_applied",
      { type: "insurance_policy", id: me.policyId },
      { kind: "pay_in_full", yearly_saving_cents: 13_320 },
    );
    await expect(applySaving(me.userId, pay.id, o())).rejects.toThrow(SavingError);
    // Paying yearly now: the pay-in-full is gone and never comes back; the others are
    // worked out on the new price.
    const rest = await refreshSavings(me.userId, o());
    expect(rest.map((s) => s.kind)).not.toContain("pay_in_full");
    expect(rest.find((s) => s.kind === "autopay")?.yearlySavingCents).toBe(4_712);
  });

  it("raises a deductible only on its own tap, and a bundle moves the car to the home's carrier", async () => {
    const me = await person();
    const [deductible] = (await refreshSavings(me.userId, o())).filter(
      (s) => s.kind === "higher_deductible",
    );
    await applySaving(me.userId, deductible.id, o());
    expect((await listPolicies(me.userId, o()))[0].deductibleCents).toBe(200_000);

    const home = await client.insurancePolicy.create({
      data: {
        userId: me.userId,
        kind: "home",
        carrier: "State Farm",
        source: "typed",
        status: "active",
        premiumCents: 10_000,
        premiumFrequency: "monthly",
      },
    });
    const [bundle] = (await refreshSavings(me.userId, o())).filter((s) => s.kind === "bundle");
    expect(bundle.detail).toMatchObject({ withPolicyId: home.id, withCarrier: "State Farm" });
    await applySaving(me.userId, bundle.id, o());
    const policies = await listPolicies(me.userId, o());
    expect(policies.map((p) => [p.kind, p.carrier, p.premiumCents])).toEqual([
      ["auto", "State Farm", 11_502],
      ["home", "State Farm", 9_000],
    ]);
  });

  it("remembers a no", async () => {
    const me = await person();
    const [paperless] = (await refreshSavings(me.userId, o())).filter(
      (s) => s.kind === "paperless",
    );
    await dismissSaving(me.userId, paperless.id, o());
    expect((await refreshSavings(me.userId, o())).map((s) => s.kind)).not.toContain("paperless");
    await expect(dismissSaving(me.userId, paperless.id, o())).rejects.toThrow(SavingError);
    expect((await listSavings(me.userId, o())).find((s) => s.kind === "paperless")?.status).toBe(
      "dismissed",
    );
  });

  it("is said in the chat with one tap for the same-cover ones and its own for the deductible", async () => {
    const me = await person();
    await refreshSavings(me.userId, o());
    await runJaneAgent(me.userId, { client, now: NOW, trigger: "open" });
    const all = await client.janeMessage.findMany({ where: { userId: me.userId } });
    const group = all.find((m) => parseRefs(m.refs).savingGroup);
    expect(group?.body.split("\n")[0]).toBe(
      "There are 4 ways to pay less for the cover you already have.",
    );
    expect(parseRefs(group!.refs).advice).toBe(true);
    const deductible = all.find((m) => parseRefs(m.refs).savingId);
    expect(deductible?.body).toContain("this one lowers your cover, so it's your call");

    const { message } = await takeChatAction(me.userId, group!.id, "saving.apply_all", o());
    expect(message).toMatchObject({ status: "answered" });
    expect(parseRefs(message.refs).note).toBe(
      "Done. That's about $364.68 a year less, with the same cover.",
    );
    // The deductible was not touched by that tap.
    expect((await listPolicies(me.userId, o()))[0].deductibleCents).toBe(100_000);
    await takeChatAction(me.userId, deductible!.id, "saving.no", o());
    expect(
      (await listSavings(me.userId, { ...o(), status: "offered" })).map((s) => s.kind),
    ).toEqual([]);
  });

  it("closes the chat message once it's answered on the page, and answers and tools say the same", async () => {
    const me = await person();
    await refreshSavings(me.userId, o());
    await runJaneAgent(me.userId, { client, now: NOW, trigger: "open" });
    const group = (await client.janeMessage.findMany({ where: { userId: me.userId } })).find(
      (m) => parseRefs(m.refs).savingGroup,
    )!;
    for (const s of await listSavings(me.userId, { ...o(), status: "offered" })) {
      if (s.kind !== "higher_deductible") await dismissSaving(me.userId, s.id, o());
    }
    expect(await closeAnsweredElsewhere(me.userId, o())).toBeGreaterThanOrEqual(1);
    expect((await client.janeMessage.findUniqueOrThrow({ where: { id: group.id } })).status).toBe(
      "answered",
    );
    const { reply } = await sendToJane(me.userId, "should I raise my deductible", o());
    expect(reply.body).toMatch(/Raising your deductible from \$1,000\.00 to \$2,000\.00 saves about/);
    const tool = JSON.parse((await runChatTool(me.userId, "insurance_savings", {}, o())).content);
    expect(
      tool.savings.find((s: { what: string }) => s.what === "higher_deductible"),
    ).toMatchObject({
      lowersCover: true,
      deductibleFrom: "$1,000.00",
      deductibleTo: "$2,000.00",
    });
  });
});
