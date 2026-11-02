import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const closeMistake = vi.fn();
vi.mock("@/lib/session", () => ({ requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/act-mistakes", () => ({
  closeMistake,
  MistakeError: class MistakeError extends Error {},
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("closing a reported mistake", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is for admins only", async () => {
    const { closeReported } = await import("./actions");
    requireAdmin.mockRejectedValueOnce(new Error("Not allowed"));
    await expect(closeReported(form({ id: "m", resolution: "x" }))).rejects.toThrow("Not allowed");
    expect(closeMistake).not.toHaveBeenCalled();
  });

  it("closes it with what was done", async () => {
    const { closeReported } = await import("./actions");
    await closeReported(form({ id: "m", resolution: "Wrote to them" }));
    expect(closeMistake).toHaveBeenCalledWith("m", "Wrote to them");
  });
});
