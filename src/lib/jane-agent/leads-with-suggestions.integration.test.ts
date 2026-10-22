import { randomBytes } from "node:crypto";
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
import { chatFeed } from "./messages";
import { runJaneAgent } from "./run";

// Spec step 265 against a real, migrated Postgres: the chat's opening message leads with the
// scan's top suggestions for each of the eight sample people, each with its dollars, why this
// person, the confidence percentage and its reason, and its own buttons.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

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

  it.each(PEOPLE)("$id's first chat opens on their top suggestions", async (person) => {
    const userId = made.get(person.id)!;
    await scanSuggestions(userId, { client, now: NOW });
    await runJaneAgent(userId, { client, now: NOW, trigger: "open" });
    const offered = await offeredToday(userId, { client, now: NOW });
    expect(offered.length).toBeGreaterThan(0);

    const { messages } = await chatFeed(userId, { client, now: NOW });
    const agenda = messages.find(
      (m) => m.kind === "brief" && /Good (morning|afternoon|evening)/.test(m.body),
    )!;
    expect(agenda.body).toContain("Here's what I'd do first, from looking at your money:");
    const leading = agenda.body.split("\n").filter((l) => l.startsWith("- "));
    // Each suggestion leads, with why this person and how sure Jane is, in their own figures.
    for (const o of offered.slice(0, leading.length)) {
      const line = leading.find((l) => l.includes(o.headline.replace(/[.!?]+$/, "")))!;
      expect(line, o.headline).toBeDefined();
      expect(line).toContain("Why you:");
      expect(line).toContain(`${o.confidencePercent}% sure: ${o.confidenceReason}.`);
    }
    // The first listed is the scan's best: the one from the person's written list.
    expect(person.should).toContain(offered[0].topic);
    const ids = agenda.actions.map((a) => a.id);
    expect(ids).toContain("bundle.1");
    expect(ids).toContain("bundle.no.1");
  });

  it("opens the page behind a suggestion after a yes, and a no is for good", async () => {
    const userId = made.get("renter")!;
    const { messages } = await chatFeed(userId, { client, now: NOW });
    const agenda = messages.find(
      (m) => m.kind === "brief" && m.actions.some((a) => a.id === "bundle.1"),
    )!;
    const yes = await takeChatAction(userId, agenda.id, "bundle.1", { client, now: NOW });
    expect(yes.message.refs.note).toMatch(/Good\. Here's where to do it\./);
    expect(yes.message.actions.some((a) => a.kind === "link" && a.href !== "/home")).toBe(true);
    if (agenda.actions.some((a) => a.id === "bundle.no.2")) {
      const no = await takeChatAction(userId, agenda.id, "bundle.no.2", { client, now: NOW });
      expect(no.message.refs.note).toMatch(/won't bring that up again/);
    }
  });
});
