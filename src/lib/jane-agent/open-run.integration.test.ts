import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

let release: (() => void) | null = null;
const runJaneAgent = vi.fn<() => Promise<{ posted: number }>>(async () => ({ posted: 0 }));
const chattingNow = vi.fn(async () => false);
vi.mock("./run", () => ({
  runJaneAgent: (...a: unknown[]) => (runJaneAgent as (...a: unknown[]) => unknown)(...a),
  chatting: (...a: unknown[]) => (chattingNow as (...a: unknown[]) => unknown)(...a),
}));

import { openChat } from "./open";
import { startOpenTurn } from "./open-run";

// The chat opens at once and says Jane owes it a turn; the turn starts when the browser says the
// chat is on screen, runs after that response, one at a time, and a turn that had nothing to post
// is not run again by every open of the day (founder 11-28: "taking way longer to load the chat";
// the whole turn used to run inside the page's request, about a thousand round trips, on every
// open until something was posted).

const url = process.env.TEST_DATABASE_URL;
const MORNING = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe.runIf(url)("Jane's turn when the chat opens", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  const open = (now: Date) => openChat(userId, { client, now });
  const turn = (now: Date) => startOpenTurn(userId, { client, now });
  const at = (ms: number) => new Date(MORNING.getTime() + ms);

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { email: { startsWith: "open-run-" } } });
    await client.$disconnect();
  });
  beforeEach(async () => {
    release = null;
    runJaneAgent.mockReset();
    runJaneAgent.mockResolvedValue({ posted: 0 });
    chattingNow.mockReset();
    chattingNow.mockResolvedValue(false);
    userId = (
      await client.user.create({ data: { email: `open-run-${crypto.randomUUID()}@x.com` } })
    ).id;
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
  });

  it("opens without running the agent: the page only says a turn is owed", async () => {
    const first = await open(MORNING);
    expect(first?.run).toBe("owed");
    // Opening (rendering) starts nothing, again and again: a page loaded ahead of time too.
    await open(at(MINUTE));
    await open(at(2 * MINUTE));
    expect(runJaneAgent).not.toHaveBeenCalled();
    expect(await client.janePreference.count({ where: { userId, key: "open_run" } })).toBe(0);
  });

  it("runs the turn once the chat is on screen, with the open trigger", async () => {
    expect(await turn(MORNING)).toBe("started");
    expect(runJaneAgent).toHaveBeenCalledTimes(1);
    expect(runJaneAgent).toHaveBeenCalledWith(userId, expect.objectContaining({ trigger: "open" }));
  });

  it("starts one turn at a time, however many opens ask at once", async () => {
    runJaneAgent.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ posted: 1 }))),
    );
    const first = turn(MORNING);
    await vi.waitFor(() => expect(release).not.toBeNull());
    const others = await Promise.all([turn(at(MINUTE)), turn(at(MINUTE)), turn(at(MINUTE))]);
    expect(others).toEqual(["running", "running", "running"]);
    // The page waits on it too, and says so.
    expect((await open(at(2 * MINUTE)))?.run).toBe("owed");
    release!();
    expect(await first).toBe("started");
    expect(runJaneAgent).toHaveBeenCalledTimes(1);
  });

  it("a turn that never finished does not hold the next one up for good", async () => {
    runJaneAgent.mockImplementation(() => new Promise(() => undefined));
    void turn(MORNING);
    await vi.waitFor(() => expect(runJaneAgent).toHaveBeenCalledTimes(1));
    expect(await turn(at(5 * MINUTE))).toBe("running");
    runJaneAgent.mockResolvedValue({ posted: 0 });
    expect(await turn(at(11 * MINUTE))).toBe("started");
  });

  it("a run that outlived its lease cannot close the marker of the run after it", async () => {
    const releases: Array<() => void> = [];
    runJaneAgent.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve({ posted: 0 }))),
    );
    const a = turn(MORNING);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const b = turn(at(11 * MINUTE));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await a;
    // A is over, B is still out: the page keeps listening, and B is not started twice.
    expect((await open(at(12 * MINUTE)))?.run).toBe("owed");
    expect(await turn(at(12 * MINUTE))).toBe("running");
    releases[1]();
    await b;
    expect((await open(at(13 * MINUTE)))?.run).toBe("settled");
  });

  it("keeps the page listening while a turn is out, even once it has posted something today", async () => {
    let finish: () => void = () => undefined;
    runJaneAgent.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ posted: 1 }))),
    );
    const running = turn(MORNING);
    await vi.waitFor(() => expect(runJaneAgent).toHaveBeenCalledTimes(1));
    await client.janeMessage.create({
      data: { userId, kind: "brief", body: "Hello", dedupeKey: "brief:mid", createdAt: at(MINUTE) },
    });
    expect((await open(at(2 * MINUTE)))?.run).toBe("owed");
    finish();
    await running;
    expect((await open(at(3 * MINUTE)))?.run).toBe("settled");
  });

  it("does not run again on a second open the same day when there is nothing new", async () => {
    await turn(MORNING);
    for (const later of [MINUTE, HOUR, 5 * HOUR]) {
      expect((await open(at(later)))?.run).toBe("settled");
      expect(await turn(at(later))).toBe("not owed");
    }
    expect(runJaneAgent).toHaveBeenCalledTimes(1);
  });

  it("a turn that fails is remembered too, so it is not tried on every open", async () => {
    runJaneAgent.mockRejectedValue(new Error("boom"));
    expect(await turn(MORNING)).toBe("started");
    expect((await open(at(HOUR)))?.run).toBe("settled");
    expect(await turn(at(HOUR))).toBe("not owed");
    expect(runJaneAgent).toHaveBeenCalledTimes(1);
  });

  it("runs again the next day, after new data, and after the person talks", async () => {
    await turn(MORNING);
    // Tomorrow.
    expect((await open(at(25 * HOUR)))?.run).toBe("owed");
    expect(await turn(at(25 * HOUR))).toBe("started");
    const day2 = at(26 * HOUR);
    expect((await open(day2))?.run).toBe("settled");
    // New data: an account added (a bank linked, a file uploaded).
    await client.account.create({ data: { userId, source: "csv", name: "Card", type: "credit" } });
    expect((await open(day2))?.run).toBe("owed");
    expect(await turn(day2)).toBe("started");
    expect((await open(day2))?.run).toBe("settled");
    // The person talks (a while ago, so Jane is not holding back for them).
    await client.janeMessage.create({
      data: {
        userId,
        kind: "user",
        body: "hi",
        dedupeKey: `user:${crypto.randomUUID()}`,
        createdAt: new Date(day2.getTime() - 30 * MINUTE),
      },
    });
    expect((await open(day2))?.run).toBe("owed");
    expect(await turn(day2)).toBe("started");
    expect(runJaneAgent).toHaveBeenCalledTimes(4);
  });

  it("holds its turn while they are chatting, and remembers nothing of it", async () => {
    chattingNow.mockResolvedValue(true);
    expect((await open(MORNING))?.run).toBe("settled");
    expect(await turn(MORNING)).toBe("not owed");
    chattingNow.mockResolvedValue(false);
    expect(await turn(at(11 * MINUTE))).toBe("started");
  });

  it("nothing is owed once Jane has posted today", async () => {
    await client.janeMessage.create({
      data: { userId, kind: "brief", body: "Hello", dedupeKey: "brief:test", createdAt: MORNING },
    });
    expect((await open(at(MINUTE)))?.run).toBe("settled");
    expect(await turn(at(MINUTE))).toBe("not owed");
    expect(runJaneAgent).not.toHaveBeenCalled();
  });

  it("hands the page the count the pulse compares with, while a turn is owed", async () => {
    await client.janeMessage.create({
      data: {
        userId,
        kind: "user",
        body: "hi",
        dedupeKey: `user:${crypto.randomUUID()}`,
        createdAt: at(-3 * HOUR),
      },
    });
    const owed = await open(MORNING);
    expect(owed?.run).toBe("owed");
    expect(owed?.pulseCount).toBe(1);
    await turn(MORNING);
    expect((await open(at(MINUTE)))?.pulseCount).toBe(0);
  });
});
