import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/concierge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/concierge")>()),
  changeActionStatus: vi.fn(),
}));

import { ConciergeError, changeActionStatus } from "@/lib/concierge";
import { requireAdmin } from "@/lib/session";
import { updateAction } from "./actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe("updateAction", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    vi.mocked(changeActionStatus).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));

    await expect(updateAction(null, form({ actionId: "a1", status: "done" }))).rejects.toThrow(
      "notFound",
    );
    expect(changeActionStatus).not.toHaveBeenCalled();
  });

  it("passes the form through, with blanks as null and minutes as a number", async () => {
    const result = await updateAction(
      null,
      form({ actionId: "a1", status: "done", minutesSpent: "15", notes: "  ", assignee: "sam" }),
    );

    expect(result).toEqual({ ok: true, message: expect.stringContaining("Saved") });
    expect(changeActionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin_1" }),
      "a1",
      {
        status: "done",
        assignee: "sam",
        notes: null,
        userTodo: null,
        failureReason: null,
        minutesSpent: 15,
      },
    );
  });

  it("shows the queue rule that blocked the change", async () => {
    vi.mocked(changeActionStatus).mockRejectedValue(new ConciergeError("Enter the minutes spent."));

    expect(await updateAction(null, form({ actionId: "a1", status: "done" }))).toEqual({
      ok: false,
      message: "Enter the minutes spent.",
    });
  });

  it("rejects an unknown status", async () => {
    expect(await updateAction(null, form({ actionId: "a1", status: "archived" }))).toEqual({
      ok: false,
      message: "Pick a status.",
    });
  });
});
