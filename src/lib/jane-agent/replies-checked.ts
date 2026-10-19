import { CONTROLLER_STEP_LABELS } from "@/config/controller";
import type { LastRun, StepLog } from "@/lib/controller-log";
import type { Reply } from "./replies";

// "What I checked last night" (spec step 142): one line per sector from the nightly run.

export const checkedLine = (s: StepLog) =>
  `${CONTROLLER_STEP_LABELS[s.step]}: ${s.did.replace(/\.$/, "")}${s.status === "failed" ? " (trying again)" : ""}`;

export function checkedReply(run: LastRun | null): Reply {
  if (!run) {
    return {
      body: "I haven't run my nightly checks for you yet. They run every night, and I'll tell you here what I found.",
      actions: [],
      refs: {},
    };
  }
  const changed = run.steps.reduce((n, s) => n + s.changed, 0);
  return {
    body: [
      changed === 0
        ? "Here's what I checked last night; nothing needed you."
        : "Here's what I checked last night.",
      ...run.steps.map((s) => `- ${checkedLine(s)}`),
    ].join("\n"),
    actions: [{ id: "open", label: "What Jane is doing", kind: "link", href: "/jane" }],
    refs: {},
  };
}
