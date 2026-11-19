import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// PostGrid's test mode through Jane's pipeline, against a real, migrated Postgres and a fake PostGrid
// (no network): a sample person's yes makes a certified letter at PostGrid's test mode with the
// company's documented address and the person's own name, PostGrid's signed events move it along
// through the real webhook route, and an undo before midnight Eastern cancels it at PostGrid.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { POST } from "@/app/api/connectors/[connectorId]/webhook/route";
import { CONNECTOR_HOLD_MINUTES, POSTGRID } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { removePeople, samplePerson } from "../__fixtures__/people";
import { grantConsent } from "../consent";
import { answerAction, cancelAction, executeAction, planAction } from "../pipeline";

const url = process.env.TEST_DATABASE_URL;
const ID = "sandbox_postgrid_letters";
const SECRET = "postgrid-webhook-secret-for-tests";
const MINUTE = 60_000;
const T0 = new Date("2026-11-19T15:00:00Z");
const later = new Date(T0.getTime() + (CONNECTOR_HOLD_MINUTES.other + 1) * MINUTE);
const system = () => systemDb("Test: reads what the PostGrid letters did", db);

// PostGrid in test mode: each new letter "ready" and not live; a cancel while ready works.
function fakePostGrid() {
  const send = vi.fn(async (to: string, init?: RequestInit) => {
    if (init?.method === "DELETE")
      return Response.json({ id: to.split("/").pop(), status: "cancelled", live: false });
    return Response.json(
      {
        id: `letter_${crypto.randomUUID().replaceAll("-", "")}`,
        object: "letter",
        status: "ready",
        live: false,
      },
      { status: 201 },
    );
  });
  return send;
}
const sign = (raw: string, at = new Date(), secret = SECRET) => {
  const t = at.getTime();
  const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return new Headers({ "PostGrid-Signature": `t=${t},v1=${v1}` });
};
const letterEvent = (id: string, data: Record<string, unknown>) =>
  JSON.stringify({ type: "letter.updated", data: { id, object: "letter", live: false, ...data } });

describe.runIf(url)("letters through PostGrid's test mode", () => {
  const people: string[] = [];
  let postgrid: ReturnType<typeof fakePostGrid>;
  const statusOf = async (id: string) =>
    (await system().connectorAction.findUniqueOrThrow({ where: { id } })).status;
  const post = (raw: string, headers: Headers) =>
    POST(
      new Request(`http://localhost/api/connectors/${ID}/webhook`, {
        method: "POST",
        body: raw,
        headers,
      }),
      { params: Promise.resolve({ connectorId: ID }) },
    );

  async function sent() {
    const userId = await samplePerson(db);
    people.push(userId);
    await system().user.update({ where: { id: userId }, data: { name: "Alex Sample" } });
    await grantConsent(userId, ID, ["cancel_subscriptions", "contact_companies"], { now: T0 });
    const planned = await planAction(
      userId,
      ID,
      {
        company: "LA Fitness",
        toAddress: "P.O. Box 54170, Irvine, CA 92619",
        fromName: "Alex Sample",
      },
      { idempotencyKey: crypto.randomUUID(), now: T0 },
    );
    await answerAction(
      userId,
      planned.id,
      { yes: true, amountCents: 0, fingerprint: planned.fingerprint },
      { now: T0 },
    );
    await executeAction(userId, planned.id, { now: later });
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    return { userId, id: planned.id, ref: row.externalRef! };
  }

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv(POSTGRID.testApiKeyEnv, "test_sk_fake");
    vi.stubEnv(POSTGRID.webhookSecretEnv, SECRET);
    postgrid = fakePostGrid();
    vi.stubGlobal("fetch", postgrid);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("makes the letter at PostGrid's test mode, then follows its signed events", async () => {
    const { id, ref } = await sent();
    expect(ref).toMatch(/^letter_[0-9a-f]{32}$/);
    expect(await statusOf(id)).toBe("partner_pending");
    const body = JSON.parse(
      String((postgrid.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body).toMatchObject({
      to: {
        companyName: "LA Fitness",
        addressLine1: "P.O. Box 54170",
        city: "Irvine",
        postalOrZip: "92619",
      },
      from: { firstName: "Alex", lastName: "Sample" },
      mailingClass: "certified",
    });
    expect(body.html).toContain("Please cancel my account, in the name of Alex Sample");
    const mailed = letterEvent(ref, { status: "completed" });
    expect((await post(mailed, sign(mailed))).status).toBe(200);
    expect(await statusOf(id)).toBe("succeeded");
  });

  it("refuses an event without PostGrid's signature", async () => {
    const { id, ref } = await sent();
    const mailed = letterEvent(ref, { status: "completed" });
    expect((await post(mailed, new Headers())).status).toBe(401);
    expect((await post(mailed, sign(mailed, new Date(), "guessed"))).status).toBe(401);
    expect(await statusOf(id)).toBe("partner_pending");
  });

  it("cancels at PostGrid when undone before midnight Eastern", async () => {
    const { userId, id, ref } = await sent();
    await expect(cancelAction(userId, id, { now: later })).resolves.toBe(true);
    expect(await statusOf(id)).toBe("cancelled");
    const [to, init] = postgrid.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(to).toBe(`https://api.postgrid.com/print-mail/v1/letters/${ref}`);
  });
});
