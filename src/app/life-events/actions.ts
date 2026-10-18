"use server";

import { revalidatePath } from "next/cache";
import { LIFE_EVENTS } from "@/config/life-events";
import { track } from "@/lib/analytics";
import {
  LifeEventError,
  deleteLifeEvent,
  finishLifeEvent,
  startLifeEvent,
  toggleLifeEventItem,
} from "@/lib/life-events";
import { requireUser } from "@/lib/session";

// Life-event checklists (spec step 72). One action for the whole page, so its message
// stays on screen even when the checklist it was about is finished or deleted.

export type LifeEventState = { ok: boolean; message: string } | null;

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

async function perform(userId: string, formData: FormData): Promise<string> {
  const eventId = field(formData, "eventId");
  switch (field(formData, "intent")) {
    case "start": {
      const kind = field(formData, "kind");
      await startLifeEvent(userId, kind);
      await track(userId, "life_event_started", { kind });
      return "Checklist started.";
    }
    case "tick": {
      const { checked, label } = await toggleLifeEventItem(
        userId,
        eventId,
        field(formData, "item"),
      );
      return checked ? `Ticked: ${label}.` : `Unticked: ${label}.`;
    }
    case "finish": {
      const kind = await finishLifeEvent(userId, eventId);
      await track(userId, "life_event_finished", { kind });
      return `${LIFE_EVENTS[kind].title} checklist finished.`;
    }
    case "delete":
      await deleteLifeEvent(userId, eventId);
      return "Checklist deleted.";
    default:
      throw new LifeEventError("Something went wrong. Try again.");
  }
}

export async function updateLifeEvents(
  _previous: LifeEventState,
  formData: FormData,
): Promise<LifeEventState> {
  const user = await requireUser();
  try {
    const message = await perform(user.id, formData);
    revalidatePath("/life-events");
    return { ok: true, message };
  } catch (error) {
    if (error instanceof LifeEventError) return { ok: false, message: error.message };
    throw error;
  }
}
