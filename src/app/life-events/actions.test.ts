import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/life-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/life-events")>()),
  startLifeEvent: vi.fn(),
  toggleLifeEventItem: vi.fn(),
  finishLifeEvent: vi.fn(),
  deleteLifeEvent: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { track } from "@/lib/analytics";
import {
  LifeEventError,
  deleteLifeEvent,
  finishLifeEvent,
  startLifeEvent,
  toggleLifeEventItem,
} from "@/lib/life-events";
import { updateLifeEvents } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("life-event actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a checklist for the signed-in person and records it", async () => {
    expect(await updateLifeEvents(null, form({ intent: "start", kind: "moving" }))).toEqual({
      ok: true,
      message: "Checklist started.",
    });
    expect(startLifeEvent).toHaveBeenCalledWith("u1", "moving");
    expect(track).toHaveBeenCalledWith("u1", "life_event_started", { kind: "moving" });
    expect(revalidatePath).toHaveBeenCalledWith("/life-events");
  });

  it("ticks an item and says which", async () => {
    vi.mocked(toggleLifeEventItem).mockResolvedValueOnce({ checked: true, label: "Forward mail" });
    const state = await updateLifeEvents(
      null,
      form({ intent: "tick", eventId: "e1", item: "mail" }),
    );
    expect(toggleLifeEventItem).toHaveBeenCalledWith("u1", "e1", "mail");
    expect(state).toEqual({ ok: true, message: "Ticked: Forward mail." });

    vi.mocked(toggleLifeEventItem).mockResolvedValueOnce({ checked: false, label: "Forward mail" });
    expect(
      await updateLifeEvents(null, form({ intent: "tick", eventId: "e1", item: "mail" })),
    ).toEqual({ ok: true, message: "Unticked: Forward mail." });
  });

  it("finishes and deletes", async () => {
    vi.mocked(finishLifeEvent).mockResolvedValueOnce("new_job");
    expect(await updateLifeEvents(null, form({ intent: "finish", eventId: "e1" }))).toEqual({
      ok: true,
      message: "New job checklist finished.",
    });
    expect(finishLifeEvent).toHaveBeenCalledWith("u1", "e1");
    expect(track).toHaveBeenCalledWith("u1", "life_event_finished", { kind: "new_job" });

    expect(await updateLifeEvents(null, form({ intent: "delete", eventId: "e1" }))).toEqual({
      ok: true,
      message: "Checklist deleted.",
    });
    expect(deleteLifeEvent).toHaveBeenCalledWith("u1", "e1");
  });

  it("shows problems as a message", async () => {
    vi.mocked(startLifeEvent).mockRejectedValueOnce(new LifeEventError("Already going."));
    expect(await updateLifeEvents(null, form({ intent: "start", kind: "moving" }))).toEqual({
      ok: false,
      message: "Already going.",
    });
    expect((await updateLifeEvents(null, form({ intent: "nope" })))?.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
