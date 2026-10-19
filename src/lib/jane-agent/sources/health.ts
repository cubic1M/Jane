import { HEALTH_CHANGE_WORTH_SAYING } from "@/config/health-score";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { healthNote } from "../replies-health";
import type { MessageSource } from "./source";

// Money health score (spec step 146): said the first time, then once a month when it moved
// enough to matter.
export const healthSource: MessageSource = {
  key: "health",
  gather(snapshot) {
    const view = snapshot.health;
    if (!view) return [];
    const moved = view.change && Math.abs(view.change.delta) >= HEALTH_CHANGE_WORTH_SAYING;
    if (view.before && !moved) return [];
    const note = healthNote(view);
    return [
      {
        kind: "heads_up",
        body: note.body,
        refs: note.refs,
        actions: note.actions,
        // The first time once ever; a change once a month.
        dedupeKey: view.before ? view.month : "first",
        priority: MESSAGE_PRIORITY.health,
      },
    ];
  },
};
