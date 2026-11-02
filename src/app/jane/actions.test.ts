import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const setActsStopped = vi.fn();
const revalidatePath = vi.fn();
vi.mock("@/lib/session", () => ({ requireUser }));
vi.mock("@/lib/permission/stop", () => ({ setActsStopped }));
vi.mock("next/cache", () => ({ revalidatePath }));
const grantArea = vi.fn();
const revokeArea = vi.fn();
const reportMistake = vi.fn();
vi.mock("@/lib/standing-permission", () => ({ grantArea, revokeArea }));
vi.mock("@/lib/act-mistakes", () => ({
  reportMistake,
  MistakeError: class MistakeError extends Error {},
}));
vi.mock("@/lib/permission/check", () => ({
  PermissionRefused: class PermissionRefused extends Error {},
}));

const form = (stop: string) => {
  const data = new FormData();
  data.set("stop", stop);
  return data;
};

describe("the stop-all switch on /jane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u1" });
  });

  it("turns it on and back off, for the signed-in person only", async () => {
    const { setStopAll } = await import("./actions");
    await setStopAll(form("1"));
    expect(setActsStopped).toHaveBeenLastCalledWith("u1", true);
    await setStopAll(form(""));
    expect(setActsStopped).toHaveBeenLastCalledWith("u1", false);
    expect(revalidatePath).toHaveBeenCalledWith("/jane");
  });

  it("needs someone signed in", async () => {
    const { setStopAll } = await import("./actions");
    requireUser.mockRejectedValueOnce(new Error("Not signed in"));
    await expect(setStopAll(form("1"))).rejects.toThrow("Not signed in");
    expect(setActsStopped).not.toHaveBeenCalled();
  });
});

describe("one tap per area on /jane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u1" });
  });
  const fields = (f: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(f)) data.set(k, v);
    return data;
  };

  it("grants and takes back, for known areas only", async () => {
    const { setAreaStanding } = await import("./actions");
    await setAreaStanding(fields({ sector: "bills", on: "1" }));
    expect(grantArea).toHaveBeenCalledWith("u1", "bills");
    await setAreaStanding(fields({ sector: "bills", on: "" }));
    expect(revokeArea).toHaveBeenCalledWith("u1", "bills");
    vi.clearAllMocks();
    await setAreaStanding(fields({ sector: "nonsense", on: "1" }));
    expect(grantArea).not.toHaveBeenCalled();
  });

  it("changes nothing on a real account, without an error page", async () => {
    const { setAreaStanding } = await import("./actions");
    const { PermissionRefused } = await import("@/lib/permission/check");
    grantArea.mockRejectedValueOnce(new (PermissionRefused as never as new () => Error)());
    await expect(setAreaStanding(fields({ sector: "bills", on: "1" }))).resolves.toBeUndefined();
  });

  it("reports a mistake for the signed-in person", async () => {
    const { reportAct } = await import("./actions");
    await reportAct(fields({ actId: "a1", note: "Wrong company" }));
    expect(reportMistake).toHaveBeenCalledWith("u1", "a1", "Wrong company");
    vi.clearAllMocks();
    await reportAct(fields({ note: "no id" }));
    expect(reportMistake).not.toHaveBeenCalled();
  });
});
