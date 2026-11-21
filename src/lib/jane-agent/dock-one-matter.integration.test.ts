import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadPopupStack } from "./popup-stack";

// The dock says one thing once (#2210): demo's Nov 28 had "Drop an overlapping subscription", which
// drops Spotify and Peacock, beside "Review your Spotify subscription", posted days before the pick
// was chosen. The review waits behind the pick, open, and is back once the pick goes; Netflix's
// price rise, another matter, shows beside a pick that names Netflix.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-28T23:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe.runIf(url)("a posted finding a day's pick already asks", () => {
  let client: PrismaClient;
  let userId: string;
  const PICK = "subscriptions:duplicate_subscription";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `one-matter-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.suggestion.create({
      data: {
        userId,
        key: PICK,
        capability: "subscriptions",
        topic: "duplicate_subscription",
        title: "You pay for more than one of the same kind of service: keep the one you use",
        headline: "Drop an overlapping subscription, save $240 a year",
        short: "You pay for Spotify, Audible, Peacock, Hulu and Netflix.",
        worthCents: 23_976,
        worthKind: "saves",
        confidencePercent: 80,
        confidenceReason: "12 months of charges",
        urgency: "soon",
        why: "Two music and two video services.",
        actionLabel: "Pick one to drop",
        actionHref: "/subscriptions",
        status: "selected",
        selectedOn: new Date("2026-11-28T00:00:00Z"),
        watch: {
          kind: "charge_stops",
          payees: [
            { description: "SPOTIFY USA", amountCents: 1_199, perYear: 12 },
            { description: "PEACOCK PREMIUM", amountCents: 799, perYear: 12 },
          ],
        },
      },
    });
    await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "Drop an overlapping subscription, save $240 a year",
        refs: { suggestion: PICK },
        actions: [{ id: "suggestion.yes", label: "Pick one to drop", kind: "primary" }],
        dedupeKey: `${PICK}:2026-11-28`,
        createdAt: ago(2),
      },
    });
    const finding = async (
      type: "subscription_review" | "price_increase",
      merchant: string,
      body: string,
    ) => {
      const { id } = await client.finding.create({
        data: {
          userId,
          type,
          key: `merchant:${merchant.toLowerCase()}:${type}`,
          title: body,
          annualSavingsCents: 14_388,
          confidence: "high",
          evidence: { merchant },
          status: "shown",
        },
      });
      await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body,
          refs: { findingId: id },
          actions: [
            { id: "finding.yes", label: "Yes", kind: "primary" },
            { id: "finding.no", label: "No", kind: "secondary" },
          ],
          dedupeKey: `findings:${id}`,
          createdAt: ago(72),
        },
      });
    };
    await finding("subscription_review", "Spotify", "Review your Spotify subscription.");
    await finding("price_increase", "Netflix", "Netflix went up from $15.49 to $17.99.");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const headlines = async () =>
    (await loadPopupStack(userId, { client, now: NOW })).map((m) => m.body.split("\n")[0]);

  it("holds the review behind the pick, and shows the other matter", async () => {
    const shown = await headlines();
    expect(shown).toContain("Drop an overlapping subscription, save $240/yr");
    expect(shown).not.toContain("Review your Spotify subscription.");
    expect(shown).toContain("Netflix went up from $15.49 to $17.99.");
  });

  it("shows the review again once the pick is gone, still open", async () => {
    await client.suggestion.updateMany({ where: { userId, key: PICK }, data: { status: "no" } });
    const shown = await headlines();
    expect(shown).not.toContain("Drop an overlapping subscription, save $240/yr");
    expect(shown).toContain("Review your Spotify subscription.");
  });
});
