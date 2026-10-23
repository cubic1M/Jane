import { randomBytes } from "node:crypto";
import { cardHeadline } from "@/detectors/contract";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { syncItem } from "@/lib/plaid/sync";
import { offeredToday, scanSuggestions } from "@/lib/suggestions";
import { startTrial } from "@/lib/trial";
import { takeChatAction } from "./actions";
import { cardsLine } from "./agenda";
import { chatFeed, stackedSuggestions } from "./messages";
import { runJaneAgent } from "./run";

// Spec step 265 against a real, migrated Postgres: the chat opens on the scan's top suggestions
// for each of the eight sample people, each with its dollars, why this person, the confidence
// percentage and its reason. They float over the chat as cards, the one place they appear: the
// agenda only says they're there, and the list shows them once they're answered.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
// When the chat is opened: Jane's messages are written a millisecond apart from NOW.
const OPENED = new Date(NOW.getTime() + 60_000);

describe.runIf(url)("Jane leads with suggestions", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made = new Map<string, string>();

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    for (const p of PEOPLE) {
      const trial = await startTrial({ client, now: NOW, defer: true, person: p.id });
      await syncItem(trial.itemId, { client, now: NOW });
      made.set(p.id, trial.userId);
    }
  }, 240_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE)("$id's first chat opens on their top suggestions, as cards", async (person) => {
    const userId = made.get(person.id)!;
    await scanSuggestions(userId, { client, now: NOW });
    await runJaneAgent(userId, { client, now: NOW, trigger: "open" });
    const offered = await offeredToday(userId, { client, now: NOW });
    expect(offered.length).toBeGreaterThan(0);

    // The cards: each suggestion with why this person and how sure Jane is, in their own
    // figures, the scan's best first (the one from the person's written list).
    const cards = await stackedSuggestions(userId, { client, now: OPENED });
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0].refs.suggestion).toBe(offered[0].key);
    expect(person.should).toContain(offered[0].topic);
    for (const card of cards) {
      const o = offered.find((s) => s.key === card.refs.suggestion)!;
      expect(card.body.split("\n")[0]).toBe(cardHeadline(o.headline));
      expect(card.body).toContain("Why you:");
      expect(card.body).toContain(`${o.confidencePercent}% sure: ${o.confidenceReason}.`);
    }

    // The agenda says they're there, once, and repeats neither the lines nor the buttons; the
    // list doesn't show them either: the cards are the one place.
    const { messages } = await chatFeed(userId, { client, now: OPENED });
    const agenda = messages.find(
      (m) => m.kind === "brief" && /Good (morning|afternoon|evening)/.test(m.body),
    )!;
    expect(agenda.body).toContain(cardsLine(cards.length));
    for (const o of offered) expect(agenda.body).not.toContain(cardHeadline(o.headline));
    expect(agenda.actions.map((a) => a.id)).not.toContain("bundle.no.1");
    expect(agenda.refs.items?.some((i) => i.action === "suggestion.yes") ?? false).toBe(false);
    const listed = new Set(messages.map((m) => m.id));
    for (const card of cards) expect(listed.has(card.id)).toBe(false);
  });

  it("opens the page behind a suggestion after a yes, keeps it in the history, and a no is for good", async () => {
    const userId = made.get("renter")!;
    const [first, second] = await stackedSuggestions(userId, { client, now: OPENED });
    const yes = await takeChatAction(userId, first.id, "suggestion.yes", { client, now: OPENED });
    expect(yes.message.refs.note).toMatch(/Good\. Here's where to do it\./);
    expect(yes.message.actions.some((a) => a.kind === "link")).toBe(true);
    // Answered, it is history: back in the list with what was chosen, and off the cards.
    const { messages } = await chatFeed(userId, { client, now: OPENED });
    expect(messages.find((m) => m.id === first.id)).toMatchObject({ status: "answered" });
    const left = await stackedSuggestions(userId, { client, now: OPENED });
    expect(left.map((m) => m.id)).not.toContain(first.id);
    if (second) {
      const no = await takeChatAction(userId, second.id, "suggestion.no", { client, now: OPENED });
      expect(no.message.refs.note).toMatch(/won't bring that up again/);
    }
  });
});
