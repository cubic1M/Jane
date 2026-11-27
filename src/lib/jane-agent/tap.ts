import type { MessageView } from "./view";

// What every tap on a message's button carries back to tapButton (src/app/chat/actions.ts): the
// message, the button, and what the card showed (`shown`, `flowShown`), so a yes acts on what the
// card said. One builder for the chat's form, the dock, Home and the pick sheets: a new token is
// added here, never on one path only (#2305 added `shown` and the dock's taps went out without it).

type Shown = Pick<MessageView, "flowShown" | "shown">;

// The hidden fields a form posts with its buttons.
export function shownFields(message: Shown): Record<string, string> {
  return {
    ...(message.flowShown ? { flowShown: message.flowShown } : {}),
    ...(message.shown ? { shown: message.shown } : {}),
  };
}

export function tapPayload(
  message: Shown & Pick<MessageView, "id">,
  actionId: string,
  choice?: string,
): FormData {
  const data = new FormData();
  data.set("messageId", message.id);
  data.set("actionId", actionId);
  if (choice) data.set("choice", choice);
  for (const [name, value] of Object.entries(shownFields(message))) data.set(name, value);
  return data;
}
