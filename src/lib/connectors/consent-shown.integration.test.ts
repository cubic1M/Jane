import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// What the connections page offers is word for word what the consent record keeps as shown: a legal
// scope (FCRA, Nacha, IRS 7216) appears in its approved text, never our short label, and one with no
// approved text isn't offered at all.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { CONSENT_SCOPES } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { fakeSandbox } from "./__fixtures__/connectors";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { connectionsView, grantConsent } from "./consent";
import { useConnectorsForTests } from "./registry";

const url = process.env.TEST_DATABASE_URL;

// Stands in for a partner's approved text: not real legal wording.
const APPROVED = { version: "test-2026-11", text: "TEST ONLY: stand-in for an approved text." };

describe.runIf(url)("the words offered are the words kept", () => {
  const people: string[] = [];
  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    useConnectorsForTests([
      fakeSandbox({
        id: "fake_legal",
        name: "Fake Legal",
        scopes: ["read_accounts", "soft_credit_pull"],
        consentText: { soft_credit_pull: APPROVED },
      }).connector,
      fakeSandbox({ id: "fake_unapproved", scopes: ["ach_debit_authorization"] }).connector,
    ]);
  });
  afterEach(() => useConnectorsForTests(null));

  it("shows a legal scope in its approved text, and keeps exactly what was shown", async () => {
    const userId = await samplePerson(db);
    people.push(userId);
    const offered = (await connectionsView(userId)).available;
    expect(offered.map((c) => c.id)).toEqual(["fake_legal"]);
    const labels = offered[0]!.scopes.map((s) => s.label);
    expect(labels).toEqual([
      CONSENT_SCOPES.read_accounts,
      `${APPROVED.text} (version ${APPROVED.version})`,
    ]);

    await grantConsent(userId, "fake_legal", ["read_accounts", "soft_credit_pull"]);
    const row = await systemDb(
      "Test: reads the consent record",
      db,
    ).connectorConsent.findFirstOrThrow({ where: { userId } });
    expect(row.shownText).toBe(["Fake Legal may:", ...labels.map((l) => `- ${l}`)].join("\n"));
  });
});
