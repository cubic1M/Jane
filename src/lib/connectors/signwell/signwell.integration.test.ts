import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SignWell's sandbox twin end to end on sample data, through the connections page's own actions:
// allow, plan, yes, the hold, the run. Who signs comes from the person's own profile, never the
// request; a company Jane doesn't know is refused; a real account never reaches either.

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
const system = () => systemDb("Test: reads what the SignWell twin did", db);
const MINUTE = 60 * 1000;
const network = vi.fn(() => {
  throw new Error("no network in tests");
});
const form = (fields: Record<string, string | number>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, String(value));
  return data;
};

describe.runIf(url)("a letter that lets Jane act for the person, sandbox", () => {
  const people: string[] = [];
  let sample: string;

  beforeAll(async () => {
    sample = await samplePerson(db);
    people.push(sample);
    await system().user.update({ where: { id: sample }, data: { name: "Alex Sample" } });
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

  it("allow, plan, yes, run: signed by the person's own name, simulated", async () => {
    session.userId = sample;
    await allowConnector(
      form({ connectorId: "sandbox_signwell_permission", scope: "sign_letters" }),
    );
    const planned = await planAction(
      sample,
      "sandbox_signwell_permission",
      // What the request says about who signs is ignored: the profile's name and email are used.
      {
        company: "netflix",
        acts: "cancel",
        signerName: "Somebody Else",
        signerEmail: "x@evil.example",
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    expect(planned.amountCents).toBe(0);
    const steps = Object.fromEntries(planned.steps.map((s) => [s.label, s.value]));
    expect(steps["With"]).toBe("Netflix");
    expect(steps["Signed by"]).toBe("Alex Sample");
    expect(steps["Sent to you to sign at"]).toMatch(/@example\.com$/);
    expect(steps["Lets Jane"]).toContain("cancel my account");
    await answerConnectorAction(
      form({
        actionId: planned.id,
        answer: "yes",
        amountCents: planned.amountCents,
        fingerprint: planned.fingerprint,
      }),
    );
    const later = new Date(Date.now() + (CONNECTOR_HOLD_MINUTES.other + 1) * MINUTE);
    await expect(executeAction(sample, planned.id, { now: later })).resolves.toBe("succeeded");
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    expect(row.simulated).toBe(true);
    expect(row.note).toMatch(/^Simulated: nothing real was sent\./);
  });

  it("refuses a company Jane doesn't know, and a task outside the list", async () => {
    await expect(
      planAction(
        sample,
        "sandbox_signwell_permission",
        { company: "Acme Unknown Co", acts: "cancel" },
        {
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    ).rejects.toMatchObject({ reason: "check_failed" });
    await expect(
      planAction(
        sample,
        "sandbox_signwell_permission",
        { company: "Netflix", acts: "move_money" },
        {
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    ).rejects.toMatchObject({ reason: "check_failed" });
  });

  it("never reaches a real account", async () => {
    const real = await realPerson(db);
    people.push(real);
    for (const id of ["signwell_permission", "sandbox_signwell_permission"]) {
      await expect(
        planAction(real, id, { company: "Netflix", acts: "cancel" }, { idempotencyKey: "k" }),
      ).rejects.toMatchObject({
        reason: id.startsWith("sandbox") ? "sandbox_for_samples" : "switched_off",
      });
    }
  });
});
