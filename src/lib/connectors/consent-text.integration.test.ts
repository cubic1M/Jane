import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The record of what a person agreed to when they allowed a connector: the exact words, a version,
// and where they agreed from. Legal scopes (FCRA, Nacha, IRS 7216) need the partner's approved text,
// word for word; Jane writes none of it.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const request = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    if (!request.headers) throw new Error("outside a request");
    return request.headers;
  }),
}));
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId })),
  getCurrentUser: vi.fn(async () => ({ id: session.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { allowConnector } from "@/app/settings/connections/actions";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { fakeSandbox } from "./__fixtures__/connectors";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { connectionsView, consentWords, grantConsent } from "./consent";
import { useConnectorsForTests } from "./registry";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads the consent record", db);

// Stands in for a partner's approved text: not real legal wording.
const APPROVED = {
  version: "test-2026-11",
  text: "TEST ONLY: stand-in for an approved soft-pull text.",
};

describe("consentWords", () => {
  it("lists our words per scope, and a legal scope's approved text with its version", () => {
    const plain = fakeSandbox().connector;
    expect(consentWords(plain, ["pay_bills"])).toBe(
      "Fake Sandbox may:\n- Pay a bill, after your yes on that payment",
    );
    expect(consentWords(plain, ["soft_credit_pull"])).toBeNull();
    const legal = fakeSandbox({ consentText: { soft_credit_pull: APPROVED } }).connector;
    expect(consentWords(legal, ["pay_bills", "soft_credit_pull"])).toBe(
      `Fake Sandbox may:\n- Pay a bill, after your yes on that payment\n- ${APPROVED.text} (version ${APPROVED.version})`,
    );
  });
});

describe.runIf(url)("the consent record", () => {
  const people: string[] = [];
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    return data;
  };

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    request.headers = null;
    useConnectorsForTests([
      fakeSandbox({ scopes: ["pay_bills", "soft_credit_pull"] }).connector,
      fakeSandbox({
        id: "fake_legal",
        name: "Fake Legal",
        scopes: ["soft_credit_pull"],
        consentText: { soft_credit_pull: APPROVED },
      }).connector,
    ]);
  });
  afterEach(() => useConnectorsForTests(null));

  async function person() {
    const id = await samplePerson(db);
    people.push(id);
    return id;
  }

  it("keeps the words shown and a version that changes only with them", async () => {
    const a = await person();
    const b = await person();
    await grantConsent(a, "fake_sandbox", ["pay_bills"]);
    await grantConsent(b, "fake_sandbox", ["pay_bills"]);
    const [rowA, rowB] = await Promise.all(
      [a, b].map((userId) => system().connectorConsent.findFirstOrThrow({ where: { userId } })),
    );
    expect(rowA!.shownText).toBe("Fake Sandbox may:\n- Pay a bill, after your yes on that payment");
    expect(rowA!.textVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(rowB!.textVersion).toBe(rowA!.textVersion);
    // Outside a request there's nowhere they agreed from.
    expect(rowA).toMatchObject({ ip: null, userAgent: null });
    const legal = await person();
    await grantConsent(legal, "fake_legal", ["soft_credit_pull"]);
    const rowL = await system().connectorConsent.findFirstOrThrow({ where: { userId: legal } });
    expect(rowL.shownText).toContain(`${APPROVED.text} (version ${APPROVED.version})`);
    expect(rowL.textVersion).not.toBe(rowA!.textVersion);
  });

  it("refuses a legal scope that has no approved text", async () => {
    const userId = await person();
    await expect(grantConsent(userId, "fake_sandbox", ["soft_credit_pull"])).rejects.toMatchObject({
      reason: "needs_text",
    });
    expect(await system().connectorConsent.count({ where: { userId } })).toBe(0);
  });

  it("records where they agreed from when they allow it on the page, and shows them the words", async () => {
    const userId = await person();
    session.userId = userId;
    request.headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "user-agent": "Mozilla/5.0 (test)",
    });
    await allowConnector(form({ connectorId: "fake_sandbox", scope: "pay_bills" }));
    const row = await system().connectorConsent.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({ ip: "203.0.113.7", userAgent: "Mozilla/5.0 (test)" });
    const view = await connectionsView(userId);
    expect(view.current[0]!.shownText).toBe(row.shownText);
    const audit = await system().auditLog.findFirstOrThrow({
      where: { targetId: userId, event: "connector_consent_granted" },
    });
    expect(JSON.stringify(audit.metadata)).toContain(row.textVersion!);
  });
});
