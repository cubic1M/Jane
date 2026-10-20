import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { listPreferences, postingOf, savePreference } from "./preferences";
import { lengthDraft, shapeReply, styleOf, voiceDraft } from "./style";
import { sendToJane } from "./typing";

// Spec step 188 against a real Postgres: saying "keep it short" offers to remember it, the tap
// saves it, and the next answers follow it; Settings' choices are the same preferences.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("Jane's way of talking, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("offers to remember it, and answers follow it once saved", async () => {
    const user = await client.user.create({
      data: { email: `style-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const { reply } = await sendToJane(user.id, "keep it short", { client });
    expect(reply.body).toMatch(/^I can remember that: keep answers short\./);
    expect(reply.actions.map((a) => a.id)).toContain("pref.save");
    expect(reply.refs.preference).toMatchObject({ kind: "style", key: "length" });
    // Nothing is saved until the tap.
    expect(styleOf(await listPreferences(user.id, { client })).length).toBe("normal");

    await savePreference(user.id, lengthDraft("short"), { client });
    await savePreference(user.id, voiceDraft("numbers"), { client });
    const prefs = await listPreferences(user.id, { client });
    expect(styleOf(prefs)).toEqual({ length: "short", voice: "numbers" });
    expect(postingOf(prefs)).toBe("daily");
    const shaped = shapeReply(
      { body: "A.\n- one\n- two\n- three", actions: [], refs: {} },
      styleOf(prefs),
    );
    expect(shaped.body.split("\n")).toHaveLength(3);
  });
});
