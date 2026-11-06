import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The sandbox letters connector, shaped like PostGrid in test mode: the midnight-Eastern stop
// window, PostGrid's "t=,v1=" signature, and its letter statuses read into Jane's, through the real
// webhook route against a real, migrated Postgres. Nothing is mailed.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { POST } from "@/app/api/connectors/[connectorId]/webhook/route";
import { CONNECTOR_HOLD_MINUTES } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { removePeople, samplePerson } from "../__fixtures__/people";
import { grantConsent } from "../consent";
import { answerAction, cancelAction, executeAction, planAction } from "../pipeline";
import { signatureValid } from "../webhooks";
import { nextMidnightEastern, parsePostGridEvent, sandboxLetters } from "./letters";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what the letters did", db);
const SECRET = "sandbox-letters-secret-for-tests";
const MINUTE = 60 * 1000;

const sign = (raw: string, at = new Date(), secret = SECRET) => {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return new Headers({ "PostGrid-Signature": `t=${t},v1=${v1}` });
};
const letterEvent = (id: string, data: Record<string, unknown>) =>
  JSON.stringify({ type: "letter.updated", data: { id, object: "letter", live: false, ...data } });

describe("nextMidnightEastern", () => {
  it("is the next midnight in New York, in winter and in summer", () => {
    // 2026-11-06 14:00 EST (UTC-5) -> 2026-11-07 00:00 EST.
    expect(nextMidnightEastern(new Date("2026-11-06T19:00:00Z")).toISOString()).toBe(
      "2026-11-07T05:00:00.000Z",
    );
    // 2026-07-01 23:30 EDT (UTC-4) -> 2026-07-02 00:00 EDT.
    expect(nextMidnightEastern(new Date("2026-07-02T03:30:00Z")).toISOString()).toBe(
      "2026-07-02T04:00:00.000Z",
    );
  });
});

describe("PostGrid's signature and events", () => {
  const signing = sandboxLetters.webhook!.signing;
  const env = { SANDBOX_LETTERS_WEBHOOK_SECRET: SECRET };
  const now = new Date("2026-11-06T18:00:00Z");

  it("takes t=,v1= in one header, inside the window, with a rotating second v1", () => {
    const raw = letterEvent("letter_1", { status: "ready" });
    expect(signatureValid(signing, raw, sign(raw, now), { env, now })).toBe(true);
    expect(signatureValid(signing, raw, sign(raw, now, "wrong"), { env, now })).toBe(false);
    const old = new Date(now.getTime() - 10 * MINUTE);
    expect(signatureValid(signing, raw, sign(raw, old), { env, now })).toBe(false);
    const good = sign(raw, now).get("PostGrid-Signature")!;
    const rotated = new Headers({
      "PostGrid-Signature": `${good.split(",")[0]},v1=${"0".repeat(64)},${good.split(",")[1]}`,
    });
    expect(signatureValid(signing, raw, rotated, { env, now })).toBe(true);
    expect(
      signatureValid(signing, raw, new Headers({ "PostGrid-Signature": "v1=abc" }), { env, now }),
    ).toBe(false);
  });

  it("reads PostGrid's statuses into Jane's", () => {
    const parse = (data: Record<string, unknown>) =>
      parsePostGridEvent(JSON.parse(letterEvent("letter_1", data)));
    expect(parse({ status: "processed_for_delivery", trackingNumber: "9400" })).toMatchObject({
      outcome: "info",
      note: "On its way (processed_for_delivery). Tracking: 9400.",
    });
    expect(parse({ status: "completed" })).toMatchObject({ outcome: "done" });
    expect(parse({ status: "cancelled", cancellation: { cancelledByUser: false } })).toMatchObject({
      outcome: "failed",
    });
    expect(parse({ status: "cancelled", cancellation: { cancelledByUser: true } })).toMatchObject({
      outcome: "info",
    });
    expect(parse({ status: "completed", imbStatus: "returned_to_sender" })).toMatchObject({
      outcome: "failed",
    });
    expect(
      parsePostGridEvent({ type: "postcard.updated", data: { id: "x", status: "ready" } }),
    ).toBeNull();
  });
});

describe.runIf(url)("the sandbox letters connector end to end", () => {
  const people: string[] = [];
  const T0 = new Date(Date.now() - 3 * 24 * 60 * MINUTE);
  const later = new Date(T0.getTime() + (CONNECTOR_HOLD_MINUTES.other + 1) * MINUTE);

  const post = (raw: string, headers: Headers) =>
    POST(
      new Request("http://localhost/api/connectors/sandbox_letters/webhook", {
        method: "POST",
        body: raw,
        headers,
      }),
      { params: Promise.resolve({ connectorId: "sandbox_letters" }) },
    );
  const statusOf = async (id: string) =>
    (await system().connectorAction.findUniqueOrThrow({ where: { id } })).status;

  async function sent() {
    const userId = await samplePerson(db);
    people.push(userId);
    await grantConsent(userId, "sandbox_letters", ["cancel_subscriptions", "contact_companies"], {
      now: T0,
    });
    const planned = await planAction(
      userId,
      "sandbox_letters",
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
    return { userId, id: planned.id, ref: row.externalRef!, cancelUntil: row.cancelUntil! };
  }

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("SANDBOX_LETTERS_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("queues the letter with a stop window to midnight Eastern, then follows PostGrid's events", async () => {
    const { id, ref, cancelUntil } = await sent();
    expect(await statusOf(id)).toBe("partner_pending");
    expect(cancelUntil.toISOString()).toBe(nextMidnightEastern(later).toISOString());
    const printing = letterEvent(ref, { status: "processed_for_delivery", trackingNumber: "9400" });
    expect((await post(printing, sign(printing))).status).toBe(200);
    expect(await statusOf(id)).toBe("partner_pending");
    const mailed = letterEvent(ref, { status: "completed" });
    expect((await post(mailed, sign(mailed))).status).toBe(200);
    expect(await statusOf(id)).toBe("succeeded");
    // Returned after it was mailed: PostGrid's late return can't undo a finished action yet (the
    // roadmap's "undone" outcome, not built), so it stays as it was.
    const returned = letterEvent(ref, { status: "completed", imbStatus: "returned_to_sender" });
    await post(returned, sign(returned));
    expect(await statusOf(id)).toBe("succeeded");
  });

  it("fails when PostGrid refuses to print it", async () => {
    const { id, ref } = await sent();
    const refused = letterEvent(ref, {
      status: "cancelled",
      cancellation: { cancelledByUser: false, reason: "invalid_content" },
    });
    await post(refused, sign(refused));
    expect(await statusOf(id)).toBe("failed");
  });

  it("is stopped before midnight Eastern, and not after", async () => {
    const early = await sent();
    await expect(cancelAction(early.userId, early.id, { now: later })).resolves.toBe(true);
    expect(await statusOf(early.id)).toBe("cancelled");
    const late = await sent();
    const afterMidnight = new Date(late.cancelUntil.getTime() + MINUTE);
    await expect(cancelAction(late.userId, late.id, { now: afterMidnight })).resolves.toBe(false);
    expect(await statusOf(late.id)).toBe("partner_pending");
  });

  it("refuses a delivery without PostGrid's signature", async () => {
    const { id, ref } = await sent();
    const mailed = letterEvent(ref, { status: "completed" });
    expect((await post(mailed, new Headers())).status).toBe(401);
    expect((await post(mailed, sign(mailed, new Date(), "guessed"))).status).toBe(401);
    expect(await statusOf(id)).toBe("partner_pending");
  });
});
