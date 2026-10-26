import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { listDeadlines } from "@/lib/deadlines";
import { loadInsurance } from "@/lib/insurance/profile";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { gather } from "@/lib/jane-agent/brain";
import { postMessages } from "@/lib/jane-agent/messages";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { foundPoliciesSource } from "@/lib/jane-agent/sources/found-policies";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { policiesFromPayments } from "./found-policies";

// Spec step 99 against a real, migrated Postgres: someone renting who pays Progressive and
// Lemonade every month gets both added as "found from your payments", with estimated
// renewals on Deadlines; nothing counts as cover until Confirm; Not insurance takes one off
// for good; a policy already on the profile (the demo bank's GEICO) is never added again.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T15:00:00Z");

describe.runIf(url)("insurance found from payments", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const months = [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ];
    const row = (
      date: string,
      description: string,
      amountCents: number,
      pfc: [string, string],
      merchantName: string | null = null,
    ) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      description,
      merchantName,
      amountCents,
      pfcPrimary: pfc[0],
      pfcDetailed: pfc[1],
    });
    const INSURANCE: [string, string] = ["GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE"];
    await client.transaction.createMany({
      data: [
        ...months.map((m) =>
          row(`${m}-01`, "OAK APARTMENTS RENT", 180_000, [
            "RENT_AND_UTILITIES",
            "RENT_AND_UTILITIES_RENT",
          ]),
        ),
        // Progressive since Jan 5; Lemonade since Mar 12.
        ...months.map((m) => row(`${m}-05`, "PROGRESSIVE *INS", 11_800, INSURANCE, "Progressive")),
        ...months.slice(2).map((m) => row(`${m}-12`, "LEMONADE INC", 1_400, INSURANCE, "Lemonade")),
      ],
    });
    return user.id;
  }

  async function post(userId: string) {
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    await postMessages(
      userId,
      gather(snapshot!, NOW, { trigger: "open", sources: [foundPoliciesSource] }),
      {
        client,
        now: NOW,
      },
    );
    return client.janeMessage.findMany({
      where: { userId, dedupeKey: { startsWith: "found:" } },
      orderBy: { body: "asc" },
    });
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("adds each insurer once as found, by itself, and nothing counts until confirmed", async () => {
    const userId = await person("found-add");
    await runJaneAgent(userId, { client, now: NOW, trigger: "cron" });
    const policies = await client.insurancePolicy.findMany({
      where: { userId },
      orderBy: { carrier: "asc" },
    });
    expect(
      policies.map((p) => [
        p.carrier,
        p.kind,
        p.status,
        p.source,
        p.premiumCents,
        p.premiumFrequency,
      ]),
    ).toEqual([
      ["Lemonade", "renters", "found", "payments", 1_400, "monthly"],
      ["Progressive", "auto", "found", "payments", 11_800, "monthly"],
    ]);
    // A year from the first payment seen.
    expect(policies.map((p) => p.renewalDate?.toISOString().slice(0, 10))).toEqual([
      "2027-03-12",
      "2027-01-05",
    ]);
    // Again: nothing new.
    expect(await policiesFromPayments(userId, { client, now: NOW })).toBe(0);
    // Found renters cover isn't cover yet.
    expect((await loadInsurance(userId, { client, now: NOW })).gaps.map((g) => g.key)).toContain(
      "renters",
    );
  });

  it("asks in the chat, and Confirm makes it cover", async () => {
    const userId = await person("found-confirm");
    await policiesFromPayments(userId, { client, now: NOW });
    const [progressive, lemonade] = await post(userId);
    expect(progressive.body).toBe(
      "I found your car insurance from your payments: Progressive, $118.00 a month. It looks like it renews around Jan 5 (an estimate from when the payments started). Is that right? It only counts on your profile once you confirm it.",
    );
    const { message } = await takeChatAction(userId, lemonade.id, "policy.confirm", {
      client,
      now: NOW,
    });
    expect(message.refs.note).toBe(
      "Confirmed. Your Lemonade renters insurance is on your profile. Add its deductible and limits on Insurance so I can check the cover.",
    );
    expect(
      (await loadInsurance(userId, { client, now: NOW })).gaps.map((g) => g.key),
    ).not.toContain("renters");
    // Confirming twice is refused, changing nothing.
    await expect(
      takeChatAction(userId, lemonade.id, "policy.confirm", { client, now: NOW }),
    ).rejects.toMatchObject({ code: "not_open" });
  });

  it("takes one off for good on Not insurance", async () => {
    const userId = await person("found-not");
    await policiesFromPayments(userId, { client, now: NOW });
    const [progressive] = await post(userId);
    await takeChatAction(userId, progressive.id, "policy.not_insurance", { client, now: NOW });
    expect(
      await client.insurancePolicy.findFirst({ where: { userId, carrier: "Progressive" } }),
    ).toMatchObject({
      status: "removed",
    });
    expect(await policiesFromPayments(userId, { client, now: NOW })).toBe(0);
  });

  it("puts estimated renewals on Deadlines", async () => {
    const userId = await person("found-deadlines");
    await policiesFromPayments(userId, { client, now: NOW });
    // Within the next 90 days only: Progressive renews Jan 5.
    const deadlines = await listDeadlines(userId, { client, now: NOW });
    expect(deadlines.filter((d) => d.source === "insurance")).toMatchObject([
      {
        title: "Progressive car insurance renews (estimate)",
        date: "2027-01-05",
        amountCents: 11_800,
        href: "/insurance",
      },
    ]);
  });

  it("never adds the demo bank's GEICO again, nor reaches anyone else's policies", async () => {
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("no Plaid");
        },
      },
    ) as PlaidApi;
    const user = await client.user.create({
      data: { email: `found-demo-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    await policiesFromPayments(user.id, { client, now: NOW });
    const geico = await client.insurancePolicy.findMany({
      where: { userId: user.id, merchantKey: "geico" },
    });
    expect(geico.map((p) => p.source)).toEqual(["demo"]);

    const owner = await person("found-owner");
    const other = await person("found-other");
    await policiesFromPayments(owner, { client, now: NOW });
    const [message] = await post(owner);
    await expect(
      takeChatAction(other, message.id, "policy.confirm", { client, now: NOW }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
