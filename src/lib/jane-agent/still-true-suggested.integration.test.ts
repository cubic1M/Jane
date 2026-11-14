import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { findingFingerprint } from "./snapshot";
import { stillTrue } from "./still-true";
import { MESSAGE_SELECT, toChatMessage } from "./types";

// Debugger 11-14: a student who uploaded one checking statement had 15 cards in the dock, two of
// them twice: "Stop paying bank and card fees, save $144/yr" (the nightly scan's suggestion) and,
// ten cards on, "$36.00 in fees on Chase checking in the last 3 months" (the finding behind it),
// the same $12 a month; and idle cash, as a suggestion and as a finding. A finding card whose type
// is the topic of a suggestion the scan offered, answered or not, is put away; others stay.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-14T08:30:00Z");

describe.runIf(url)("a finding a suggestion already brings up", () => {
  let client: PrismaClient;
  let userId: string;

  const finding = (type: "bank_fees" | "idle_cash" | "subscription_review", title: string) =>
    client.finding.create({
      data: {
        userId,
        type,
        key: `${type}-${crypto.randomUUID()}`,
        title,
        annualSavingsCents: 14_400,
        confidence: "medium",
        evidence: {},
        status: "new",
      },
    });
  const card = async (f: Awaited<ReturnType<typeof finding>>) =>
    client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: `${f.title}. Could save about $144.00 a year. Want the steps to do it yourself?`,
        refs: { findingId: f.id, fingerprint: findingFingerprint(f) },
        actions: [{ id: "finding.yes", label: "Yes", kind: "primary" }],
        dedupeKey: f.id,
        createdAt: NOW,
      },
    });
  const suggestion = (topic: string, status: string) =>
    client.suggestion.create({
      data: {
        userId,
        key: `money:${topic}`,
        capability: "money",
        topic,
        title: topic,
        worthCents: 14_400,
        worthKind: "saves",
        confidencePercent: 59,
        confidenceReason: "three months of data",
        urgency: "normal",
        why: "",
        actionLabel: "See how",
        actionHref: "/money",
        status,
        selectedOn: new Date("2026-11-14T00:00:00Z"),
        ...(status === "selected" ? {} : { answeredAt: NOW }),
      },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `still-true-suggested-${crypto.randomUUID()}@example.com` },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("puts away the fee and idle-cash cards, and keeps a card no suggestion covers", async () => {
    const fees = await card(
      await finding("bank_fees", "$36.00 in fees on Chase checking in the last 3 months"),
    );
    const idle = await card(
      await finding("idle_cash", "$1,307.91 more cash than 3 months of spending"),
    );
    const netflix = await card(
      await finding("subscription_review", "Review your Netflix subscription"),
    );
    // Fees still offered; idle cash answered No.
    await suggestion("bank_fees", "selected");
    await suggestion("idle_cash", "no");

    const open = (
      await client.janeMessage.findMany({
        where: { userId, status: "open" },
        select: MESSAGE_SELECT,
      })
    ).map(toChatMessage);
    const shown = await stillTrue(userId, open, { client, now: NOW });

    expect(shown.map((m) => m.id)).toEqual([netflix.id]);
    const stored = await client.janeMessage.findMany({
      where: { id: { in: [fees.id, idle.id, netflix.id] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(stored.map((m) => [m.id, m.status === "open"]))).toEqual({
      [fees.id]: false,
      [idle.id]: false,
      [netflix.id]: true,
    });
  });
});
