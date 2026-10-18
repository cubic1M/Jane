import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/deadlines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deadlines")>()),
  addDeadline: vi.fn(),
  markDeadlineDone: vi.fn(),
  deleteDeadline: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { DeadlineError, addDeadline, deleteDeadline, markDeadlineDone } from "@/lib/deadlines";
import { finishDeadline, removeDeadline, saveDeadline } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const fields = { title: "FSA deadline", dueOn: "2026-12-31", kind: "fsa", note: "" };

describe("deadline actions", () => {
  it("adds for the signed-in person and keeps the message on screen", async () => {
    expect(await saveDeadline(null, form(fields))).toEqual({
      ok: true,
      message: "Added. Jane will remind you a few days before.",
    });
    expect(addDeadline).toHaveBeenCalledWith("u1", fields);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("shows validation as a message", async () => {
    vi.mocked(addDeadline).mockRejectedValueOnce(new DeadlineError("Pick a date."));
    expect(await saveDeadline(null, form(fields))).toEqual({ ok: false, message: "Pick a date." });
  });

  it("marks done and deletes for the signed-in person", async () => {
    await finishDeadline(form({ deadlineId: "d1" }));
    expect(markDeadlineDone).toHaveBeenCalledWith("u1", "d1");
    await removeDeadline(form({ deadlineId: "d2" }));
    expect(deleteDeadline).toHaveBeenCalledWith("u1", "d2");
    expect(revalidatePath).toHaveBeenCalledWith("/deadlines");
  });
});
