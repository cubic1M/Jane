import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/db-scoped", () => ({
  scopedDb: vi.fn(async () => ({ actions: { findMany: vi.fn(async () => [{ id: "a1" }]) } })),
}));
vi.mock("@/lib/agent/run", () => ({ runQueuedFor: vi.fn() }));
vi.mock("@/lib/autopilot", () => {
  class AutopilotError extends Error {}
  return { AutopilotError, setAutopilot: vi.fn(async () => 3) };
});

import { after } from "next/server";
import { AutopilotError, setAutopilot } from "@/lib/autopilot";
import { chooseAutopilot } from "./autopilot-actions";

const form = (level: string) => {
  const data = new FormData();
  data.set("level", level);
  return data;
};

describe("choosing autopilot", () => {
  it("sets the level for the signed-in person and starts the agent on what it approved", async () => {
    expect(await chooseAutopilot(null, form("safe"))).toMatchObject({
      ok: true,
      message: expect.stringContaining("started on 3 things"),
    });
    expect(setAutopilot).toHaveBeenCalledWith("u1", "safe");
    expect(after).toHaveBeenCalled();
  });

  it("explains a bad choice", async () => {
    vi.mocked(setAutopilot).mockRejectedValueOnce(new AutopilotError("Pick one of the choices."));
    expect(await chooseAutopilot(null, form("x"))).toEqual({
      ok: false,
      message: "Pick one of the choices.",
    });
  });
});
