import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// A profile correction refreshes the chat's numbers in the background: not needed here.
vi.mock("@/lib/jane-agent/primer-store", () => ({ markPrimerStale: vi.fn() }));

import { CORRECTED_CONFIDENCE, START_CONFIDENCE } from "@/config/memory";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { logAudit } from "@/lib/audit";
import { deleteAllData } from "@/lib/account-deletion";
import { exportUserData } from "@/lib/data-export";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { deletePreference, listPreferences, savePreference } from "@/lib/jane-agent/preferences";
import { sendToJane } from "@/lib/jane-agent/typing";
import { loadProfileInput } from "@/lib/profile";
import { cleanUpTrials } from "@/lib/trial";
import {
  correctFact,
  forgetEverything,
  forgetFact,
  listFacts,
  MemoryError,
  recordFact,
} from "./facts";
import { learnFromAnswer } from "./learn";

// What Jane knows about a person, against a real, migrated Postgres: each piece of evidence
// raises, lowers or replaces a fact; only the person's own facts are ever read or changed;
// sensitive traits are never stored; the chat's messages are kept and linked to what they
// taught; and correcting, forgetting and deleting (one fact, all memory, a trial, the account)
// leave nothing behind.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T15:00:00Z");
const HOUR = 3_600_000;
const later = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

describe.runIf(url)("what Jane knows, against a real database", () => {
  let client: PrismaClient;
  const made: string[] = [];

  const person = async (id?: string, createdAt = NOW) => {
    const user = await client.user.create({
      data: {
        ...(id ? { id } : {}),
        email: `memory-${crypto.randomUUID()}@example.com`,
        createdAt,
      },
    });
    made.push(user.id);
    return user.id;
  };
  const rows = (userId: string) =>
    client.userFact.findMany({ where: { userId }, orderBy: { firstSeen: "asc" } });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  beforeEach(() => vi.mocked(logAudit).mockClear());

  it("raises a fact on new evidence, and replaces it when the person says otherwise", async () => {
    const userId = await person();
    const rent = { key: "housing", value: "rent", label: "You rent your home" };
    expect(
      await recordFact(
        userId,
        { ...rent, source: "detector", sourceRef: "scan", confidence: 62 },
        { client, now: NOW },
      ),
    ).toBe("created");
    // The same scan again isn't new evidence.
    expect(
      await recordFact(
        userId,
        { ...rent, source: "detector", sourceRef: "scan", confidence: 62 },
        { client, now: later(1) },
      ),
    ).toBe("unchanged");
    // Said in the chat: more sure, and now the person's word.
    expect(
      await recordFact(
        userId,
        { ...rent, source: "chat", sourceRef: "jane_message:m1" },
        { client, now: later(2) },
      ),
    ).toBe("confirmed");
    let [fact] = await listFacts(userId, { client });
    expect(fact).toMatchObject({
      value: "rent",
      source: "chat",
      sourceRef: "jane_message:m1",
      confidence: START_CONFIDENCE.chat + 10,
      evidenceCount: 2,
    });

    // They bought a place: the answer replaces it, the old fact kept as history.
    expect(
      await recordFact(
        userId,
        { key: "housing", value: "own", label: "You own your home", source: "answer" },
        { client, now: later(3) },
      ),
    ).toBe("superseded");
    const facts = await listFacts(userId, { client });
    expect(facts).toHaveLength(1);
    [fact] = facts;
    expect(fact).toMatchObject({ value: "own", confidence: START_CONFIDENCE.answer });
    const history = await rows(userId);
    expect(history).toHaveLength(2);
    expect(history[0].supersededById).toBe(fact.id);
  });

  it("never stores a sensitive trait, whatever it came from", async () => {
    const userId = await person();
    for (const draft of [
      { key: "goal:church_trip", value: "church trip", label: "Saving for a church trip" },
      { key: "health_costs", value: true, label: "You spend a lot on health care" },
      { key: "note", value: "on a work visa", label: "On a work visa" },
    ]) {
      expect(await recordFact(userId, { ...draft, source: "chat" }, { client, now: NOW })).toBe(
        "blocked",
      );
    }
    expect(await rows(userId)).toHaveLength(0);
  });

  it("only ever reads, corrects or forgets the person's own facts", async () => {
    const me = await person();
    const other = await person();
    await recordFact(
      me,
      { key: "main_bank", value: "Chase", label: "Your main bank is Chase", source: "detector" },
      { client, now: NOW },
    );
    const [mine] = await listFacts(me, { client });
    expect(await listFacts(other, { client })).toEqual([]);
    expect(await forgetFact(other, mine.id, { client, now: NOW })).toBe(false);
    await expect(correctFact(other, mine.id, "Wells Fargo", { client, now: NOW })).rejects.toThrow(
      MemoryError,
    );
    expect(await listFacts(me, { client })).toHaveLength(1);
  });

  it("corrects a fact to what the person says, as sure as it gets, and logs it", async () => {
    const userId = await person();
    await recordFact(
      userId,
      { key: "goal:car", value: "a car", label: "You're saving for a car", source: "chat" },
      { client, now: NOW },
    );
    const [goal] = await listFacts(userId, { client });
    await correctFact(userId, goal.id, "a used car by spring", { client, now: later(1) });
    const [fixed] = await listFacts(userId, { client });
    expect(fixed).toMatchObject({
      key: "goal:car",
      value: "a used car by spring",
      label: "Your goal: a used car by spring",
      source: "answer",
      confidence: CORRECTED_CONFIDENCE,
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "memory_fact_corrected",
      { type: "user", id: userId },
      { family: "goal", source: "chat" },
    );
    // Typed in a correction, a sensitive detail isn't kept either.
    await expect(
      correctFact(userId, fixed.id, "my church", { client, now: later(2) }),
    ).rejects.toThrow("Jane doesn't keep that kind of detail.");

    // A profile fact goes through the profile's correction, so the older answers agree.
    await recordFact(
      userId,
      { key: "housing", value: "rent", label: "You rent", source: "detector", confidence: 70 },
      { client, now: NOW },
    );
    const housing = (await listFacts(userId, { client })).find((f) => f.key === "housing")!;
    await correctFact(userId, housing.id, "own", { client, now: later(3) });
    expect((await listFacts(userId, { client })).find((f) => f.key === "housing")).toMatchObject({
      value: "own",
      source: "answer",
      confidence: CORRECTED_CONFIDENCE,
    });
    expect(
      await client.insuranceProfile.findUnique({ where: { userId }, select: { housing: true } }),
    ).toEqual({ housing: "own" });
    expect((await listPreferences(userId, { client })).map((p) => p.key)).toContain(
      "profile:housing",
    );
  });

  it("forgets a fact for good: the data doesn't bring it back, the person saying it does", async () => {
    const userId = await person();
    const bank = { key: "main_bank", value: "Chase", label: "Your main bank is Chase" };
    await recordFact(
      userId,
      { ...bank, source: "detector", sourceRef: "scan" },
      { client, now: NOW },
    );
    const [fact] = await listFacts(userId, { client });
    expect(await forgetFact(userId, fact.id, { client, now: later(1) })).toBe(true);
    expect(await listFacts(userId, { client })).toEqual([]);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "memory_fact_deleted",
      { type: "user", id: userId },
      { family: "main_bank", source: "detector" },
    );
    // Only the key is left behind, with no value, so tonight's scan doesn't learn it again.
    expect(await rows(userId)).toEqual([
      expect.objectContaining({ key: "main_bank", source: "forgotten", value: {}, label: "" }),
    ]);
    expect(
      await recordFact(
        userId,
        { ...bank, source: "detector", sourceRef: "scan" },
        { client, now: later(2) },
      ),
    ).toBe("forgotten");
    expect(
      await recordFact(
        userId,
        { ...bank, source: "chat", sourceRef: "jane_message:m9" },
        { client, now: later(3) },
      ),
    ).toBe("created");
    expect(await listFacts(userId, { client })).toHaveLength(1);
  });

  it("keeps the preferences Jane saved and what it knows in step", async () => {
    const userId = await person();
    await savePreference(
      userId,
      {
        kind: "fact",
        key: "payday",
        value: { days: [1, 15] },
        label: "Paid on the 1st and the 15th",
      },
      { client },
    );
    const [payday] = await listFacts(userId, { client });
    expect(payday).toMatchObject({
      key: "payday",
      value: "1,15",
      source: "answer",
      sourceRef: "preference:fact:payday",
    });
    // Forgotten on /settings/memory: the preference goes too, so nothing reads it any more.
    await forgetFact(userId, payday.id, { client, now: NOW });
    expect(await listPreferences(userId, { client })).toEqual([]);

    // Deleted as a preference: the fact goes too.
    await savePreference(
      userId,
      { kind: "never", key: "finding:abc", value: {}, label: "Don't suggest the gym again" },
      { client },
    );
    expect((await listFacts(userId, { client })).map((f) => f.key)).toEqual(["never:finding:abc"]);
    const [pref] = await listPreferences(userId, { client });
    await deletePreference(userId, pref.id, { client });
    expect(await listFacts(userId, { client })).toEqual([]);
  });

  it("learns habits from what the person does with suggestions, flipping only on enough of it", async () => {
    const userId = await person();
    const answer = (acted: boolean, n: number) =>
      learnFromAnswer(
        userId,
        { topic: "subscriptions", acted, ref: `suggestion:s${n}` },
        {
          client,
          now: later(n),
        },
      );
    await answer(true, 1);
    await answer(false, 2);
    expect((await listFacts(userId, { client }))[0]).toMatchObject({ value: "acts" });
    await answer(false, 3);
    expect((await listFacts(userId, { client }))[0]).toMatchObject({
      key: "habit:subscriptions",
      value: "passes",
      label: "You tend to pass on subscriptions suggestions",
    });
  });

  it("deletes all memory and stored conversations, and keeps what's waiting on the person", async () => {
    const userId = await person();
    await recordFact(
      userId,
      { key: "prefers_diy", value: true, label: "You'd rather do things yourself", source: "chat" },
      { client, now: NOW },
    );
    await savePreference(
      userId,
      { kind: "style", key: "length", value: { length: "short" }, label: "Keep it short" },
      { client },
    );
    const message = (kind: string, key: string) =>
      client.janeMessage.create({ data: { userId, kind, body: kind, dedupeKey: key } });
    await message("user", "typed:1");
    await message("reply", "reply:1");
    await message("decision", "finding:1");
    await client.askConversation.create({
      data: { userId, title: "Old", messages: { create: { userId, role: "user", content: "hi" } } },
    });

    expect(await forgetEverything(userId, { client })).toEqual({
      facts: 2,
      preferences: 1,
      messages: 2,
      conversations: 1,
    });
    expect(await client.userFact.count({ where: { userId } })).toBe(0);
    expect(await client.janePreference.count({ where: { userId } })).toBe(0);
    expect(await client.askMessage.count({ where: { userId } })).toBe(0);
    expect(
      (await client.janeMessage.findMany({ where: { userId }, select: { kind: true } })).map(
        (m) => m.kind,
      ),
    ).toEqual(["decision"]);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "memory_deleted_all",
      { type: "user", id: userId },
      { facts: 2, preferences: 1, messages: 2, conversations: 1 },
    );
  });

  it("goes with a trial person after their hours, and with a deleted account", async () => {
    const trialId = await person(
      `${TRIAL_ID_PREFIX}${randomBytes(12).toString("hex")}`,
      new Date(Date.now() - 200 * HOUR),
    );
    const realId = await person();
    for (const userId of [trialId, realId]) {
      await recordFact(
        userId,
        { key: "housing", value: "rent", label: "You rent", source: "chat" },
        { client, now: NOW },
      );
      await client.janeMessage.create({
        data: { userId, kind: "user", body: "I rent", dedupeKey: `typed:${userId}` },
      });
    }
    await cleanUpTrials({ client });
    expect(await client.userFact.count({ where: { userId: trialId } })).toBe(0);
    expect(await client.janeMessage.count({ where: { userId: trialId } })).toBe(0);
    expect(await client.userFact.count({ where: { userId: realId } })).toBe(1);

    await deleteAllData(realId, { client, api: {} as PlaidApi });
    expect(await client.userFact.count({ where: { userId: realId } })).toBe(0);
    expect(await client.janeMessage.count({ where: { userId: realId } })).toBe(0);
  });

  describe("from the chat", () => {
    let userId: string;
    beforeAll(async () => {
      userId = await createCheckPerson({ client, now: NOW });
    }, 120_000);
    afterAll(() => deleteCheckPerson(userId, { client }));

    it("keeps the message, learns from it, links the two, and the profile uses it", async () => {
      const { sent } = await sendToJane(userId, "I rent, and I'm saving for a wedding", {
        client,
        now: NOW,
      });
      expect(
        await client.janeMessage.findUnique({ where: { id: sent.id }, select: { body: true } }),
      ).toEqual({ body: "I rent, and I'm saving for a wedding" });
      const facts = await listFacts(userId, { client });
      expect(facts.find((f) => f.key === "goal:wedding")).toMatchObject({
        source: "chat",
        sourceRef: `jane_message:${sent.id}`,
      });
      expect(facts.find((f) => f.key === "housing")).toMatchObject({ value: "rent" });
      // What they said is what the profile, and so every detector, works from.
      const input = await loadProfileInput(userId, { client, now: later(1) });
      expect(input.told.housing).toBe("rent");

      // In Download my data.
      const data = await exportUserData(userId, { client });
      expect(data.userFacts.map((f) => f.key)).toEqual(
        expect.arrayContaining(["housing", "goal:wedding"]),
      );
    });
  });
});
