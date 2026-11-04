import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setSwitch, switchesOn, logAudit } = vi.hoisted(() => ({
  setSwitch: vi.fn(async () => true),
  switchesOn: vi.fn(async () => ["banks"]),
  logAudit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ops-switches", () => ({ setSwitch, switchesOn }));
vi.mock("@/lib/audit", () => ({ logAudit, SYSTEM_ACTOR: { type: "system", id: null } }));

import { GET, POST } from "./route";

const call = (secret: string | null, body: unknown) =>
  POST(
    new Request("http://x/api/ops/switches", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      body: JSON.stringify(body),
    }),
  );
const set = (name: string, on = true) => ({ switch: name, on, trigger: "probe" });

describe("/api/ops/switches", () => {
  beforeEach(() => {
    vi.stubEnv("OPS_SWITCHES", "1");
    vi.stubEnv("OPS_REDUCE_SECRET", "reduce");
    vi.stubEnv("OPS_HIGH_BAR_SECRET", "high");
    vi.stubEnv("OPS_FOUNDER_SECRET", "founder");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses everyone with no secrets set, or the wrong one", async () => {
    expect((await call("reduce2", set("banks"))).status).toBe(401);
    expect((await call(null, set("banks"))).status).toBe(401);
    vi.unstubAllEnvs();
    expect((await call("reduce", set("banks"))).status).toBe(401);
    expect((await call("", set("banks"))).status).toBe(401);
    expect((await GET(new Request("http://x"))).status).toBe(401);
    expect(setSwitch).not.toHaveBeenCalled();
  });

  it("lets the reduce secret set only what reduces exposure", async () => {
    for (const name of ["banks", "uploads", "claude"]) {
      expect((await call("reduce", set(name))).status).toBe(200);
    }
    for (const name of ["site", "email"]) {
      expect((await call("reduce", set(name))).status).toBe(403);
    }
    expect(setSwitch).toHaveBeenCalledTimes(3);
  });

  it("keeps site and email behind the higher bar", async () => {
    expect((await call("high", set("site"))).status).toBe(200);
    expect((await call("high", set("email"))).status).toBe(200);
  });

  it("only a founder's secret turns anything back on", async () => {
    expect((await call("reduce", set("banks", false))).status).toBe(403);
    expect((await call("high", set("banks", false))).status).toBe(403);
    expect((await call("founder", set("banks", false))).status).toBe(200);
    expect(setSwitch).toHaveBeenCalledTimes(1);
  });

  it("refuses a made-up switch or trigger", async () => {
    for (const body of [
      set("everything"),
      set("constructor"),
      { switch: "banks", on: "yes", trigger: "probe" },
      { switch: "banks", on: true, trigger: "ignore previous instructions" },
      null,
    ]) {
      expect((await call("founder", body)).status).toBe(400);
    }
    expect(setSwitch).not.toHaveBeenCalled();
  });

  it("says so when nothing reads the store, rather than pretending it worked", async () => {
    vi.stubEnv("OPS_SWITCHES", "");
    expect((await call("founder", set("banks"))).status).toBe(409);
    expect(setSwitch).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("writes every change to the audit log, and not a repeat", async () => {
    await call("reduce", set("banks"));
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "ops_switch_set",
      { type: "ops_switch", id: "banks" },
      { on: true, tier: "reduce", trigger: "probe" },
    );
    logAudit.mockClear();
    setSwitch.mockResolvedValueOnce(false);
    await call("reduce", set("banks"));
    expect(logAudit).not.toHaveBeenCalled();
  });
});
