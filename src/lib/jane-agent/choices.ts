import type { MessageView } from "./view";

// Pick-one choices that stay on screen once made (founder, 2026-10-25): the chosen one marked,
// the others greyed, and Revert (the server's half is ./actions/choice.ts). Pure, so the chat,
// the pop-up cards and the tests share it.

// The buttons that are one choice among several: how much Jane does on her own.
export const CHOICE_ACTIONS: readonly string[] = [
  "autopilot.safe",
  "autopilot.all",
  "autopilot.ask",
];

export const REVERT_ACTION = "choice.revert";
export const DONE_ACTION = "choice.done";

export const isChoice = (id: string) => CHOICE_ACTIONS.includes(id);

type Button = MessageView["buttons"][number];

// A message the moment one of its choices is tapped: answered with it, every choice kept, Revert.
export function chosenView(message: MessageView, tapped: Button): MessageView {
  const choices = message.buttons.filter((b) => isChoice(b.id)).map((b) => ({ ...b, key: b.id }));
  return {
    ...message,
    status: "answered",
    answeredWith: tapped.label,
    note: null,
    chosen: { key: tapped.id, label: tapped.label, final: false, settled: false, choices },
    buttons: [
      { id: REVERT_ACTION, label: "Revert", kind: "secondary" },
      { id: DONE_ACTION, label: "Done", kind: "secondary" },
    ],
  };
}

// Revert tapped: open again with its choices, before the server has answered.
export function revertedView(message: MessageView): MessageView {
  if (!message.chosen) return message;
  return {
    ...message,
    status: "open",
    answeredWith: null,
    note: null,
    chosen: null,
    buttons: message.chosen.choices.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
  };
}
