import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CONTROLLER_STEPS } from "@/config/controller";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { checkedSource } from "@/lib/jane-agent/sources/checked";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { lastControllerRun } from "./controller-log";
import { queueNightlyRuns, retryControllerStep, runController } from "./controller";

// Spec step 142 against a real, migrated Postgres: one run per person each night, every
// sector in order through its own code, a failing sector never stopping the others and
// retried through the jobs table, and a log that says what ran and what changed.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
// 5am in Los Angeles, the next night.
const NIGHT = new Date("2026-10-19T12:00:00Z");
const MORNING = new Date("2026-10-19T15:00:00Z");

describe.runIf(url)("the nightly controller run", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function demoPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, autopilot: "safe" },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api, now: LINKED });
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("runs every sector in order, logs what each did, and runs once a night", async () => {
    const userId = await demoPerson("controller-all");
    const logs = await runController(userId, { client, now: NIGHT, api });
    expect(logs.map((l) => l.step)).toEqual([...CONTROLLER_STEPS]);
    expect(logs.every((l) => l.status === "ok")).toBe(true);
    const sync = logs.find((l) => l.step === "sync")!;
    expect(sync.did).toMatch(/^Synced 1 bank: \d+ new transactions?\.$/);
    expect(logs.find((l) => l.step === "changes")!.did).toMatch(/changes? to look at\.$/);
    // Kept as the night's log.
    const run = await lastControllerRun(userId, { client, now: MORNING });
    expect(run).toMatchObject({ day: "2026-10-19" });
    expect(run!.steps.map((s) => s.step)).toEqual([...CONTROLLER_STEPS]);
    // Again the same night: nothing runs twice.
    const insurance = vi.fn(async () => ({ did: "x", changed: 0 }));
    expect(await runController(userId, { client, now: NIGHT, api, steps: { insurance } })).toEqual(
      run!.steps,
    );
    expect(insurance).not.toHaveBeenCalled();
  });

  it("never lets a failing sector stop the others, and retries it through the jobs table", async () => {
    const userId = await demoPerson("controller-fail");
    // The insurance partner is down tonight.
    const down = vi.fn(async () => {
      throw new Error("partner down");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = await runController(userId, {
      client,
      now: NIGHT,
      api,
      steps: { insurance: down },
    });
    errors.mockRestore();
    expect(logs.find((l) => l.step === "insurance")).toMatchObject({
      status: "failed",
      did: "Couldn't check tonight; I'll try again.",
    });
    // Everything after it still ran.
    expect(logs.slice(3).every((l) => l.status === "ok")).toBe(true);
    const job = await client.job.findFirstOrThrow({
      where: {
        kind: "controller_step",
        status: "queued",
        payload: { path: ["userId"], equals: userId },
      },
    });
    expect(job.payload).toEqual({ userId, step: "insurance" });
    // The retry fixes the night's log.
    await retryControllerStep(userId, "insurance", { client, now: NIGHT });
    const run = await lastControllerRun(userId, { client, now: MORNING });
    expect(run!.steps.find((s) => s.step === "insurance")?.status).toBe("ok");
    await client.job.deleteMany({ where: { id: job.id } });
  });

  it("stops starting steps once out of time, and says so", async () => {
    const userId = await demoPerson("controller-budget");
    const logs = await runController(userId, { client, now: NIGHT, api, budgetMs: -1 });
    expect(
      logs.every((l) => l.status === "skipped" && l.did === "Out of time tonight; tomorrow."),
    ).toBe(true);
  });

  it("queues one run per person with an account, skipping who already ran", async () => {
    const ran = await demoPerson("controller-queue-ran");
    await runController(ran, { client, now: NIGHT, api });
    const waiting = await demoPerson("controller-queue-waiting");
    const drain = vi.fn(async () => ({ done: 0, retried: 0, failed: 0 }));
    const { queued } = await queueNightlyRuns({ client, now: NIGHT, drain });
    expect(queued).toBeGreaterThanOrEqual(1);
    const jobs = await client.job.findMany({ where: { kind: "controller_run", status: "queued" } });
    const users = jobs.map((j) => (j.payload as { userId: string }).userId);
    expect(users).toContain(waiting);
    expect(users).not.toContain(ran);
    // A second call queues nobody twice.
    await queueNightlyRuns({ client, now: NIGHT, drain });
    const again = await client.job.findMany({
      where: { kind: "controller_run", status: "queued" },
    });
    expect(again.filter((j) => (j.payload as { userId: string }).userId === waiting)).toHaveLength(
      1,
    );
    expect(drain).toHaveBeenCalled();
    await client.job.deleteMany({ where: { id: { in: again.map((j) => j.id) } } });
  });

  it("says what it checked in the chat, by rules and to Claude, for the person only", async () => {
    const userId = await demoPerson("controller-chat");
    await runController(userId, { client, now: NIGHT, api });
    const snapshot = await loadSnapshot(userId, { client, now: MORNING });
    const [message] = gather(snapshot!, MORNING, { trigger: "open", sources: [checkedSource] });
    expect(message).toMatchObject({ kind: "done", dedupeKey: "checked:2026-10-19" });
    expect(message.body.split("\n")[0]).toMatch(/^Here's what I checked last night/);
    expect(message.body).toMatch(/\n- Bank: Synced 1 bank/);
    expect(message.body.split("\n")).toHaveLength(1 + CONTROLLER_STEPS.length);
    const reply = await answerByRules(userId, { kind: "checked" }, { client, now: MORNING });
    expect(reply?.body).toBe(message.body);
    const tool = JSON.parse(
      (await runChatTool(userId, "nightly_log", {}, { client, now: MORNING })).content,
    );
    expect(tool.checked).toHaveLength(CONTROLLER_STEPS.length);
    const other = await demoPerson("controller-other");
    expect(await lastControllerRun(other, { client, now: MORNING })).toBeNull();
  });
});
