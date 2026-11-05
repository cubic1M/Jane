import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { suggestionsSource } from "@/lib/jane-agent/sources/suggestions";
import { gather } from "@/lib/jane-agent/brain";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { offeredToday } from "./suggestions";

// A walk of every sample life found it: picks made while someone had only the demo bank wait in
// the table until the next scan, and a real account's chat posted them meanwhile: "Drop your
// mortgage insurance, save $1,690/yr", with Yes.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");

describe.runIf(url)("what's offered once a real account has joined", () => {
  let client: PrismaClient;
  const made: string[] = [];

  const person = async () => {
    const { id } = await client.user.create({
      data: { email: `offered-${crypto.randomUUID()}@example.com` },
    });
    made.push(id);
    await client.plaidItem.create({
      data: {
        userId: id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:x",
      },
    });
    return id;
  };
  const pick = (userId: string, topic: string, title: string) =>
    client.suggestion.create({
      data: {
        userId,
        key: `debt:${topic}`,
        capability: "debt",
        topic,
        title,
        headline: title,
        short: "Your mortgage carries it",
        why: "Your mortgage carries it.",
        worthCents: 169_000,
        worthKind: "savings",
        confidencePercent: 80,
        confidenceReason: "one mortgage record",
        urgency: "soon",
        actionLabel: "Show me",
        actionHref: "/loans",
        status: "selected",
        selectedOn: NOW,
      },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  it("offers advice to someone with only the demo bank", async () => {
    const id = await person();
    await pick(id, "pmi_removal", "Drop your mortgage insurance");
    const offered = await offeredToday(id, { client, now: NOW });
    expect(offered.map((s) => s.topic)).toEqual(["pmi_removal"]);
  });

  it("stops it as soon as a real account is there, before any scan", async () => {
    const id = await person();
    await pick(id, "pmi_removal", "Drop your mortgage insurance");
    await pick(id, "subscriptions", "Cancel a subscription you stopped using");
    await client.account.create({
      data: { userId: id, source: "csv", name: "Real checking", type: "depository" },
    });
    const offered = await offeredToday(id, { client, now: NOW });
    expect(offered.map((s) => s.topic)).toEqual(["subscriptions"]);
    const snapshot = await loadSnapshot(id, { client, now: NOW });
    const planned = gather(snapshot!, NOW, {
      trigger: "open",
      realAccount: true,
      sources: [suggestionsSource],
    });
    expect(planned.map((m) => m.body).join("\n")).not.toContain("mortgage insurance");
    // The row stays for the scan to remove, so what it does with it doesn't change.
    expect(await client.suggestion.count({ where: { userId: id, topic: "pmi_removal" } })).toBe(1);
  });
});
