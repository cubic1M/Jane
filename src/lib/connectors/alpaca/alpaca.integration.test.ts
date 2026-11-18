import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Alpaca's sandbox adapters end to end on sample data, through the connections page's own actions:
// allow, plan, yes, the money hold, the run, all simulated, with every request blocked. Crypto is
// refused at the plan; a real account never reaches either.

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

import { allowConnector, answerConnectorAction } from "@/app/settings/connections/actions";
import { CONNECTOR_HOLD_MINUTES } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople, samplePerson } from "../__fixtures__/people";
import { executeAction, planAction } from "../pipeline";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what the Alpaca sandbox did", db);
const MINUTE = 60 * 1000;
const network = vi.fn(() => {
  throw new Error("no network in tests");
});
const form = (fields: Record<string, string | number>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, String(value));
  return data;
};

describe.runIf(url)("Alpaca's Broker API, sandbox only", () => {
  const people: string[] = [];
  let sample: string;

  beforeAll(async () => {
    sample = await samplePerson(db);
    people.push(sample);
  });
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
  });

  async function yesAndRun(actionId: string, amountCents: number, fingerprint: string) {
    await answerConnectorAction(form({ actionId, answer: "yes", amountCents, fingerprint }));
    const later = new Date(Date.now() + (CONNECTOR_HOLD_MINUTES.money + 1) * MINUTE);
    return executeAction(sample, actionId, { now: later });
  }

  it("a buy: allow, plan, yes, the day's hold, the run, simulated", async () => {
    session.userId = sample;
    await allowConnector(form({ connectorId: "sandbox_alpaca_order", scope: "place_orders" }));
    const planned = await planAction(
      sample,
      "sandbox_alpaca_order",
      { ticker: "VTI", amountCents: 25_000, account: "Alpaca Individual" },
      { idempotencyKey: crypto.randomUUID() },
    );
    expect(planned.amountCents).toBe(25_000);
    await expect(yesAndRun(planned.id, planned.amountCents, planned.fingerprint)).resolves.toBe(
      "succeeded",
    );
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    expect(row.simulated).toBe(true);
    expect(row.note).toMatch(/^Simulated: nothing real was sent\. Buy \$250\.00 of VTI/);
  });

  it("the cash sweep, simulated", async () => {
    session.userId = sample;
    await allowConnector(form({ connectorId: "sandbox_alpaca_account", scope: "open_accounts" }));
    const planned = await planAction(
      sample,
      "sandbox_alpaca_account",
      { kind: "cash_sweep", account: "Alpaca Individual" },
      { idempotencyKey: crypto.randomUUID() },
    );
    await expect(yesAndRun(planned.id, planned.amountCents, planned.fingerprint)).resolves.toBe(
      "succeeded",
    );
  });

  it("refuses crypto at the plan", async () => {
    await expect(
      planAction(
        sample,
        "sandbox_alpaca_order",
        { ticker: "BTC", amountCents: 25_000, account: "Alpaca Individual" },
        { idempotencyKey: crypto.randomUUID() },
      ),
    ).rejects.toThrow();
    expect(
      await system().connectorAction.count({
        where: { userId: sample, details: { path: ["ticker"], equals: "BTC" } },
      }),
    ).toBe(0);
  });

  it("never reaches a real account", async () => {
    const real = await realPerson(db);
    people.push(real);
    for (const id of ["sandbox_alpaca_order", "sandbox_alpaca_account"]) {
      await expect(
        planAction(
          real,
          id,
          { ticker: "VTI", amountCents: 100, account: "A" },
          { idempotencyKey: "k" },
        ),
      ).rejects.toMatchObject({ reason: "sandbox_for_samples" });
    }
  });
});
