import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Connector webhook intake against a real, migrated Postgres, through the real route: signatures per
// provider, the time window, replays, and an event reaching only the person whose action it names.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

// Lets one test make applying an event fail, to see the delivery forgotten.
const failing = vi.hoisted(() => ({ next: false }));
vi.mock("./pipeline", async (importOriginal) => {
  const original = await importOriginal<typeof import("./pipeline")>();
  return {
    ...original,
    applyPartnerEvent: (...args: Parameters<typeof original.applyPartnerEvent>) => {
      if (failing.next) {
        failing.next = false;
        return Promise.reject(new Error("down"));
      }
      return original.applyPartnerEvent(...args);
    },
  };
});

import { POST } from "@/app/api/connectors/[connectorId]/webhook/route";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { WEBHOOK_MAX_BYTES, WEBHOOK_TOLERANCE_SECONDS } from "@/config/connectors";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import {
  FAKE_WEBHOOK_SECRET_ENV,
  fakeSandbox,
  fakeWebhook,
  signedHeaders,
} from "./__fixtures__/connectors";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { grantConsent } from "./consent";
import { answerAction, executeAction, planAction } from "./pipeline";
import { useConnectorsForTests } from "./registry";
import { receiveWebhook, signatureValid } from "./webhooks";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what the webhook changed", db);
const SECRET = "fake-webhook-secret-for-tests";
const MINUTE = 60 * 1000;
const T0 = new Date(Date.now() - 3 * 24 * 60 * MINUTE);

const post = (connectorId: string, raw: string, headers: Headers) =>
  POST(
    new Request(`http://localhost/api/connectors/${connectorId}/webhook`, {
      method: "POST",
      body: raw,
      headers,
    }),
    { params: Promise.resolve({ connectorId }) },
  );

describe("signatureValid", () => {
  const hmac = fakeWebhook.signing;
  const env = { [FAKE_WEBHOOK_SECRET_ENV]: SECRET };
  const now = new Date("2026-11-06T12:00:00Z");

  it("takes the provider's HMAC inside the time window only", () => {
    const raw = '{"ref":"x"}';
    expect(signatureValid(hmac, raw, signedHeaders(raw, SECRET, now), { env, now })).toBe(true);
    expect(signatureValid(hmac, `${raw} `, signedHeaders(raw, SECRET, now), { env, now })).toBe(
      false,
    );
    expect(signatureValid(hmac, raw, signedHeaders(raw, "other", now), { env, now })).toBe(false);
    const old = new Date(now.getTime() - (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000);
    expect(signatureValid(hmac, raw, signedHeaders(raw, SECRET, old), { env, now })).toBe(false);
    expect(signatureValid(hmac, raw, signedHeaders(raw, SECRET, now), { env: {}, now })).toBe(
      false,
    );
    expect(signatureValid(hmac, raw, new Headers(), { env, now })).toBe(false);
  });

  it("takes a Svix signature for a provider that signs that way", () => {
    const svix = { kind: "svix" as const, secretEnv: "FAKE_SVIX_SECRET" };
    const key = Buffer.from("svix-test-key").toString("base64");
    const raw = '{"type":"x"}';
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = createHmac("sha256", Buffer.from(key, "base64"))
      .update(`msg_1.${timestamp}.${raw}`)
      .digest("base64");
    const headers = new Headers({
      "svix-id": "msg_1",
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    });
    const svixEnv = { FAKE_SVIX_SECRET: `whsec_${key}` };
    expect(signatureValid(svix, raw, headers, { env: svixEnv, now })).toBe(true);
    expect(signatureValid(svix, raw, headers, { env: { FAKE_SVIX_SECRET: "whsec_" }, now })).toBe(
      false,
    );
  });
});

describe.runIf(url)("connector webhook intake", () => {
  const people: string[] = [];

  async function pendingAction() {
    const userId = await samplePerson(db);
    people.push(userId);
    await grantConsent(userId, "fake_sandbox", ["pay_bills"], { now: T0 });
    const planned = await planAction(
      userId,
      "fake_sandbox",
      { payee: "Con Edison", amountCents: 8412 },
      { idempotencyKey: crypto.randomUUID(), now: T0 },
    );
    await answerAction(
      userId,
      planned.id,
      { yes: true, amountCents: planned.amountCents, fingerprint: planned.fingerprint },
      { now: T0 },
    );
    await executeAction(userId, planned.id, { now: new Date(T0.getTime() + 2 * 24 * 60 * MINUTE) });
    return { userId, id: planned.id, ref: `ext_${planned.id}` };
  }
  const statusOf = async (id: string) =>
    (await system().connectorAction.findUniqueOrThrow({ where: { id } })).status;
  const event = (ref: string, outcome: string, id = crypto.randomUUID()) =>
    JSON.stringify({ id, ref, outcome });

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 6).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv(FAKE_WEBHOOK_SECRET_ENV, SECRET);
    useConnectorsForTests([fakeSandbox({ webhook: fakeWebhook }).connector]);
  });
  afterEach(() => useConnectorsForTests(null));

  it("answers 404 while off, and for a connector without webhooks", async () => {
    const raw = event("x", "done");
    vi.stubEnv("CONNECTORS", "");
    expect((await post("fake_sandbox", raw, signedHeaders(raw, SECRET))).status).toBe(404);
    vi.stubEnv("CONNECTORS", "1");
    expect((await post("nope", raw, signedHeaders(raw, SECRET))).status).toBe(404);
    useConnectorsForTests([fakeSandbox().connector]);
    expect((await post("fake_sandbox", raw, signedHeaders(raw, SECRET))).status).toBe(404);
  });

  it("believes nothing without the provider's signature", async () => {
    const { id, ref } = await pendingAction();
    const raw = event(ref, "done");
    expect((await post("fake_sandbox", raw, new Headers())).status).toBe(401);
    expect((await post("fake_sandbox", raw, signedHeaders(raw, "guessed"))).status).toBe(401);
    const stale = new Date(Date.now() - (WEBHOOK_TOLERANCE_SECONDS + 5) * 1000);
    expect((await post("fake_sandbox", raw, signedHeaders(raw, SECRET, stale))).status).toBe(401);
    const big = JSON.stringify({ ref, outcome: "done", pad: "x".repeat(WEBHOOK_MAX_BYTES) });
    expect((await post("fake_sandbox", big, signedHeaders(big, SECRET))).status).toBe(413);
    expect(await statusOf(id)).toBe("partner_pending");
  });

  it("moves the action on once, and ignores the same event again", async () => {
    const { userId, id, ref } = await pendingAction();
    const raw = event(ref, "done", `evt_${crypto.randomUUID()}`);
    const first = await post("fake_sandbox", raw, signedHeaders(raw, SECRET));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    expect(await statusOf(id)).toBe("succeeded");
    const again = await post("fake_sandbox", raw, signedHeaders(raw, SECRET));
    expect(await again.json()).toEqual({ received: true, repeat: true });
    const updates = await system().auditLog.count({
      where: { targetId: userId, event: "connector_action_updated" },
    });
    expect(updates).toBe(1);
  });

  it("reaches only the person whose action it names", async () => {
    const a = await pendingAction();
    const b = await pendingAction();
    const raw = event(a.ref, "failed");
    await post("fake_sandbox", raw, signedHeaders(raw, SECRET));
    expect(await statusOf(a.id)).toBe("failed");
    expect(await statusOf(b.id)).toBe("partner_pending");
    const unknown = event("ext_nobody", "done");
    const refused = await post("fake_sandbox", unknown, signedHeaders(unknown, SECRET));
    expect(refused.status).toBe(409);
  });

  it("keeps an event that arrives before Jane has stored the partner's id, for the retry", async () => {
    // The partner answers while act is still returning: no ref stored yet, and a 200 would lose it.
    const userId = await samplePerson(db);
    people.push(userId);
    await grantConsent(userId, "fake_sandbox", ["pay_bills"], { now: T0 });
    const planned = await planAction(
      userId,
      "fake_sandbox",
      { payee: "Con Edison", amountCents: 8412 },
      { idempotencyKey: crypto.randomUUID(), now: T0 },
    );
    const early = event(`ext_${planned.id}`, "failed", `evt_${crypto.randomUUID()}`);
    expect((await post("fake_sandbox", early, signedHeaders(early, SECRET))).status).toBe(409);
    await answerAction(
      userId,
      planned.id,
      { yes: true, amountCents: planned.amountCents, fingerprint: planned.fingerprint },
      { now: T0 },
    );
    await executeAction(userId, planned.id, { now: new Date(T0.getTime() + 2 * 24 * 60 * MINUTE) });
    expect(await statusOf(planned.id)).toBe("partner_pending");
    // The provider's retry of the same event now lands, and isn't taken for a repeat.
    const retry = await post("fake_sandbox", early, signedHeaders(early, SECRET));
    expect(await retry.json()).toEqual({ received: true });
    expect(await statusOf(planned.id)).toBe("failed");
  });

  it("refuses a body that says it's too big before reading it", async () => {
    const raw = event("x", "done");
    const headers = signedHeaders(raw, SECRET);
    headers.set("content-length", String(WEBHOOK_MAX_BYTES + 1));
    expect((await post("fake_sandbox", raw, headers)).status).toBe(413);
  });

  it("takes a reversal after success, and nothing backwards", async () => {
    const { id, ref } = await pendingAction();
    for (const outcome of ["done", "failed", "reversed", "done"]) {
      const raw = event(ref, outcome);
      await post("fake_sandbox", raw, signedHeaders(raw, SECRET));
    }
    expect(await statusOf(id)).toBe("reversed");
  });

  it("forgets the delivery when handling it fails, so the retry counts", async () => {
    const { id, ref } = await pendingAction();
    const raw = event(ref, "done", `evt_${crypto.randomUUID()}`);
    failing.next = true;
    await expect(receiveWebhook("fake_sandbox", raw, signedHeaders(raw, SECRET))).rejects.toThrow(
      "down",
    );
    expect(await (await post("fake_sandbox", raw, signedHeaders(raw, SECRET))).json()).toEqual({
      received: true,
    });
    expect(await statusOf(id)).toBe("succeeded");
  });
});
