import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A switch whose audit record can't be written stands, and the team hears what was switched.

const { setSwitch, logAudit, alertError } = vi.hoisted(() => ({
  setSwitch: vi.fn(async () => true),
  logAudit: vi.fn(async () => undefined),
  alertError: vi.fn(async () => true),
}));
vi.mock("@/lib/ops-switches", () => ({ setSwitch, switchesOn: vi.fn(async () => ["banks"]) }));
vi.mock("@/lib/audit", () => ({ logAudit, SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/error-alerts", () => ({ alertError }));

import { errorKind } from "@/lib/error-kind";
import { POST } from "./route";

const call = (on: boolean) =>
  POST(
    new Request("http://x/api/ops/switches", {
      method: "POST",
      headers: { authorization: "Bearer founder" },
      body: JSON.stringify({ switch: "banks", on, trigger: "probe" }),
    }),
  );

describe("a switch the audit log missed", () => {
  beforeEach(() => {
    vi.stubEnv("OPS_SWITCHES", "1");
    vi.stubEnv("OPS_FOUNDER_SECRET", "founder");
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    [true, "on"],
    [false, "off"],
  ])("stands, and raises an alert naming it (%s)", async (on, word) => {
    logAudit.mockRejectedValueOnce(new Error("database is away"));

    const answer = await call(on);

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ changed: true, on: ["banks"] });
    expect(setSwitch).toHaveBeenCalledTimes(1);
    const sent = {
      message: `SwitchNotRecorded.banks.${word}: turned ${word}, with no audit record`,
      path: "/api/ops/switches",
    };
    expect(alertError).toHaveBeenCalledWith(sent, { pastCeiling: true });
    // What the email's subject is made of keeps the switch and which way it went.
    expect(errorKind(sent.message)).toBe(`SwitchNotRecorded.banks.${word}`);
  });

  it("raises nothing when the record is written", async () => {
    expect((await call(true)).status).toBe(200);
    expect(alertError).not.toHaveBeenCalled();
  });
});
