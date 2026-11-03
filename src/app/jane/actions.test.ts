import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const setActsStopped = vi.fn();
const revalidatePath = vi.fn();
vi.mock("@/lib/session", () => ({ requireUser }));
vi.mock("@/lib/permission/stop", () => ({ setActsStopped }));
vi.mock("next/cache", () => ({ revalidatePath }));

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
