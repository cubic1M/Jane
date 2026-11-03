import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { killed, siteStoppedFor } from "@/config/kill-switches";
import { PrismaClient } from "@/generated/prisma/client";
import { forgetSwitchesForTests, freshSwitches, setSwitch, switchesOn } from "@/lib/ops-switches";
import { systemDb } from "@/lib/system-db";

const WHY = "This test clears the emergency switches, which belong to no one person";
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("switches in the store", () => {
  let client: PrismaClient;
  const clear = () => systemDb(WHY, client).opsSwitch.deleteMany();
  const set = (
    name: Parameters<typeof setSwitch>[0],
    on = true,
    tier: "reduce" | "high_bar" | "founder" = "reduce",
  ) => setSwitch(name, on, { tier, trigger: "test", client });
  const fresh = () => freshSwitches({ client });
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(() => client.$disconnect());
  beforeEach(async () => {
    forgetSwitchesForTests();
    await clear();
    vi.stubEnv("OPS_SWITCHES", "1");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    forgetSwitchesForTests();
    await clear();
  });

  it("applies with no deploy, and only after being read", async () => {
    await set("banks");
    expect(killed("banks")).toBe(false);
    await fresh();
    expect(killed("banks")).toBe(true);
    expect(killed("claude")).toBe(false);
  });

  it("reads nothing at all without OPS_SWITCHES=1", async () => {
    await set("banks");
    vi.stubEnv("OPS_SWITCHES", "");
    await fresh();
    expect(killed("banks")).toBe(false);
  });

  it("goes off again when a founder clears it", async () => {
    await set("uploads");
    await fresh();
    expect(killed("uploads")).toBe(true);
    await set("uploads", false, "founder");
    await fresh();
    expect(killed("uploads")).toBe(false);
  });

  it("a repeat changes nothing and says so", async () => {
    expect(await set("claude")).toBe(true);
    expect(await set("claude")).toBe(false);
    expect(await switchesOn({ client })).toEqual(["claude"]);
  });

  it("keeps a stop in place when the database can't answer", async () => {
    await set("site", true, "high_bar");
    await fresh();
    expect(siteStoppedFor("/home")).toBe(true);
    const broken = {} as never;
    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ["Date"] });
    await freshSwitches({ client: broken });
    vi.useRealTimers();
    expect(siteStoppedFor("/home")).toBe(true);
  });

  it("a stop in the store spares the door that turns it off", async () => {
    await set("site", true, "high_bar");
    await fresh();
    expect(siteStoppedFor("/api/ops/switches")).toBe(false);
    expect(siteStoppedFor("/api/export")).toBe(true);
    vi.stubEnv("KILL_SITE", "1");
    expect(siteStoppedFor("/api/ops/switches")).toBe(true);
  });
});
