import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
// The changes as they are now (src/lib/changes.ts), set by each test.
const now = vi.hoisted(() => ({ changes: [] as { key: string; title: string }[] }));
vi.mock("@/lib/changes", async (actual) => ({
  ...(await actual<typeof import("@/lib/changes")>()),
  loadChanges: vi.fn(async () => now.changes),
}));

import { BUNDLED_UNTIL } from "./messages";
import { loadPopupStack } from "./popup-stack";

// Debug 3's linked-month sweep person (11-21, daily, Dec 15): the dock had "Review your Audible
// subscription. Could save about $179.40 a year. … Want me to handle it?", posted Dec 9 and bundled
// behind that day's brief, and again "Review your Audible subscription. … subscription." without
// its question: Dec 15's "Audible is a new regular charge: $14.95, since Nov 8. Did you mean to sign
// up?", which carries the same finding, said in the finding's words once its fingerprint moved.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-12-15T23:00:00Z");
const CHANGE = "Audible is a new regular charge: $14.95, since Nov 8.";
const ASK = "Did you mean to sign up? If not, I can cancel it.";

describe.runIf(url)("one card a finding", () => {
  let client: PrismaClient;
  let userId: string;
  let changeId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `one-card-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { id: findingId } = await client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key: "merchant:audible",
        title: "Review your Audible subscription",
        annualSavingsCents: 17_940,
        confidence: "medium",
        evidence: { merchant: "Audible" },
        status: "new",
      },
    });
    // Both said when the finding read otherwise: its fingerprint has moved since.
    const refs = { findingId, fingerprint: "as-it-was" };
    await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "Review your Audible subscription. Could save about $179.40 a year. Want me to handle it?",
        refs,
        actions: [
          { id: "finding.yes", label: "Yes", kind: "primary" },
          { id: "finding.no", label: "No", kind: "secondary" },
        ],
        dedupeKey: `findings:${findingId}`,
        snoozedUntil: BUNDLED_UNTIL,
        createdAt: new Date("2026-12-09T16:00:00Z"),
      },
    });
    changeId = (
      await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: `${CHANGE} ${ASK}`,
          refs: {
            ...refs,
            change: { key: "new:merchant:audible", kind: "new_subscription", title: CHANGE },
          },
          actions: [
            { id: "change.look", label: "Cancel it", kind: "primary" },
            { id: "change.expected", label: "That's expected", kind: "secondary" },
          ],
          dedupeKey: "changes:new:merchant:audible",
          createdAt: new Date("2026-12-15T16:00:00Z"),
        },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const audible = async () =>
    (await loadPopupStack(userId, { client, now: NOW }))
      .map((m) => m.body)
      .filter((b) => b.includes("Audible"));

  const listed = (title = CHANGE) => {
    now.changes = [{ key: "new:merchant:audible", title }];
  };

  it("shows the newest card of a finding once, a change's card in its own words", async () => {
    listed();
    expect(await audible()).toEqual([`${CHANGE} ${ASK}`]);
  });

  it("says a change's card with its change's title as it is now, question kept", async () => {
    const moved = "Audible is a new regular charge: $16.95, since Nov 8.";
    listed(moved);
    expect(await audible()).toEqual([`${moved} ${ASK}`]);
  });

  it("puts a change's card away once its change goes, and the finding's own card shows", async () => {
    now.changes = [];
    const shown = await audible();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/^Review your Audible subscription\..*Want me to handle it\?$/);
  });

  it("shows the finding's own card again once the change's is answered", async () => {
    listed();
    await client.janeMessage.update({ where: { id: changeId }, data: { status: "answered" } });
    const shown = await audible();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/^Review your Audible subscription\..*Want me to handle it\?$/);
  });
});
