import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The four sandbox adapters end to end on sample data, through the connections page's own actions:
// allow, plan, yes, the hold, the run, and cancelling. With every outgoing request blocked, so a
// sandbox adapter provably reaches nobody.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId })),
  getCurrentUser: vi.fn(async () => ({ id: session.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  allowConnector,
  answerConnectorAction,
  cancelConnectorAction,
} from "@/app/settings/connections/actions";
import { CONNECTOR_HOLD_MINUTES } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople, samplePerson } from "../__fixtures__/people";
import { connectionsView } from "../consent";
import { executeAction, planAction } from "../pipeline";
import { allConnectors, connectorById, definitionProblems } from "../registry";
import { SANDBOX_CONNECTORS } from "./adapters";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what the sandbox adapters did", db);
const MINUTE = 60 * 1000;

const form = (fields: Record<string, string | number | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of [value].flat()) data.append(name, String(one));
  }
  return data;
};

// What each adapter is asked, and what its steps must say.
const REQUESTS = {
  sandbox_bill_pay: {
    request: {
      payee: "Con Edison",
      amountCents: 8412,
      fromAccount: "Checking ••1234",
      sendOn: "Nov 12",
    },
    cents: 8412,
    steps: ["Pay to", "Amount", "From", "Sends on"],
    ran: "succeeded",
  },
  sandbox_own_transfer: {
    request: { fromAccount: "Checking ••1234", toAccount: "Savings ••9876", amountCents: 25_000 },
    cents: 25_000,
    steps: ["From", "To", "Amount"],
    ran: "succeeded",
  },
  sandbox_subscription_cancel: {
    request: { merchant: "StreamCo", monthlyCents: 1599 },
    cents: 0,
    // A merchant Jane doesn't know: plain guided steps, finished by the person.
    steps: ["Cancel", "Saves", "How", "Step 1", "Step 2"],
    ran: "handed_off",
  },
  sandbox_letters: {
    request: {
      company: "LA Fitness",
      toAddress: "P.O. Box 54170, Irvine, CA 92619",
      fromName: "Alex Sample",
    },
    cents: 0,
    steps: ["To", "From", "Says", "Sent as", "Can be stopped", "Says who it is"],
    // Queued to print; PostGrid's webhooks say when it's mailed.
    ran: "partner_pending",
  },
  sandbox_insurance_quote: {
    request: { coverage: "renters", currentMonthlyCents: 2500, state: "CA" },
    cents: 0,
    steps: ["Coverage", "You pay now", "State"],
    ran: "succeeded",
  },
} as const;

describe("the sandbox adapters' definitions", () => {
  it("are all registered, all sandbox, and hold together", () => {
    for (const connector of SANDBOX_CONNECTORS) {
      expect(connector.sandbox, connector.id).toBe(true);
      expect(definitionProblems(connector), connector.id).toEqual([]);
      expect(connectorById(connector.id)).not.toBeNull();
    }
    expect(Object.keys(REQUESTS).sort()).toEqual(SANDBOX_CONNECTORS.map((c) => c.id).sort());
    // Only sandbox adapters and "Jane prepares, you do it" (which reach nobody) are registered: no
    // real partner exists yet.
    expect(
      allConnectors()
        .filter((c) => !c.sandbox)
        .map((c) => c.id),
    ).toEqual(["manual_bill_pay", "manual_own_transfer"]);
  });

  it("call nobody: no fetch, http, net or SDK in their code", () => {
    const dir = join("src", "lib", "connectors", "sandbox");
    for (const name of readdirSync(dir).filter((n) => !n.includes(".test."))) {
      const source = readFileSync(join(dir, name), "utf8");
      expect(source, name).not.toMatch(
        /\bfetch\(|node:(https?|net|tls|dgram)|from "(plaid|stripe)/,
      );
    }
  });

  it("refuse requests that don't fit together", () => {
    const transfer = connectorById("sandbox_own_transfer")!;
    expect(() =>
      transfer.prefill!({ fromAccount: "A", toAccount: "A", amountCents: 100 }),
    ).toThrow();
    expect(() => connectorById("sandbox_bill_pay")!.prefill!({ payee: "X" })).toThrow();
    expect(() =>
      connectorById("sandbox_subscription_cancel")!.prefill!({ merchant: "X", monthlyCents: 1.5 }),
    ).toThrow();
  });
});

describe.runIf(url)("the sandbox adapters end to end", () => {
  const people: string[] = [];
  const outgoing: string[] = [];

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("CONNECTORS_KILLED", "");
    outgoing.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        outgoing.push(String(input));
        throw new Error("No request leaves a sandbox test");
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const [id, { request, cents, steps, ran }] of Object.entries(REQUESTS)) {
    it(`${id}: allow, plan, yes, run, all simulated`, async () => {
      const userId = await samplePerson(db);
      people.push(userId);
      // A letter is signed with the person's own name (./letters.ts).
      await system().user.update({ where: { id: userId }, data: { name: "Alex Sample" } });
      session.userId = userId;
      const offered = (await connectionsView(userId)).available.find((c) => c.id === id);
      expect(offered).toBeDefined();
      await allowConnector(form({ connectorId: id, scope: offered!.scopes.map((s) => s.scope) }));
      const planned = await planAction(userId, id, request, {
        idempotencyKey: crypto.randomUUID(),
      });
      expect(planned.amountCents).toBe(cents);
      expect(planned.steps.map((s) => s.label)).toEqual(steps);
      await answerConnectorAction(
        form({
          actionId: planned.id,
          answer: "yes",
          amountCents: planned.amountCents,
          fingerprint: planned.fingerprint,
        }),
      );
      const connector = connectorById(id)!;
      const hold = connector.movesMoney
        ? CONNECTOR_HOLD_MINUTES.money
        : CONNECTOR_HOLD_MINUTES.other;
      const later = new Date(Date.now() + (hold + 1) * MINUTE);
      await expect(executeAction(userId, planned.id, { now: later })).resolves.toBe(ran);
      const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
      expect(row.simulated).toBe(true);
      expect(row.note).toMatch(/^Simulated: nothing real was sent\./);
      expect(row.externalRef).toMatch(/^sbx_/);
      if (connector.cancel) {
        // Taken back at the (simulated) partner, inside its window.
        await cancelConnectorAction(form({ actionId: planned.id }));
        expect(
          (await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } })).status,
        ).toBe("cancelled");
      }
      expect(outgoing).toEqual([]);
    });
  }

  it("never offers a sandbox adapter to a real account", async () => {
    const real = await realPerson(db);
    people.push(real);
    expect((await connectionsView(real)).available).toEqual([]);
    session.userId = real;
    await allowConnector(form({ connectorId: "sandbox_bill_pay", scope: "pay_bills" }));
    expect(await system().connectorConsent.count({ where: { userId: real } })).toBe(0);
    await expect(
      planAction(real, "sandbox_bill_pay", REQUESTS.sandbox_bill_pay.request, {
        idempotencyKey: "k",
      }),
    ).rejects.toMatchObject({ reason: "sandbox_for_samples" });
  });

  it("turns a request that doesn't fit into a refusal, not a crash", async () => {
    const userId = await samplePerson(db);
    people.push(userId);
    session.userId = userId;
    await allowConnector(form({ connectorId: "sandbox_own_transfer", scope: "move_own_money" }));
    await expect(
      planAction(
        userId,
        "sandbox_own_transfer",
        { fromAccount: "A", toAccount: "A", amountCents: 100 },
        { idempotencyKey: "same" },
      ),
    ).rejects.toMatchObject({ reason: "bad_request" });
  });
});
