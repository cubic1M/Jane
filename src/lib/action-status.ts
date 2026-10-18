import type { ActionStatus } from "@/generated/prisma/client";

// How each action status reads to the person on /actions and in emails.
export const ACTION_STATUS_LABELS: Record<ActionStatus, { label: string; detail: string }> = {
  queued: { label: "Queued", detail: "Our team will start on this within one business day." },
  in_progress: { label: "In progress", detail: "Our team is working on this now." },
  waiting_on_user: { label: "Waiting on you", detail: "We need something from you to continue." },
  done: { label: "Done", detail: "All finished." },
  failed: { label: "Couldn't complete", detail: "We weren't able to finish this one." },
};
