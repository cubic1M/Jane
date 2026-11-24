import { describe, expect, it } from "vitest";
import { chatList, CHAT_KINDS, inChat, popupStack } from "./popups";
import type { MessageView } from "./view";

// The dock's stack as Home and the side chat read it: the day's picks, then the other cards.
const dockOf = (ms: readonly MessageView[]) =>
  popupStack(
    ms.filter((m) => m.suggestion),
    ms.filter((m) => !m.suggestion),
    10,
  );

// Founder 11-24: a suggestion about Delta Air Lines popped up in the chat. Suggestions belong only
// in the suggestion box (the dock): nothing Jane brings up unasked is posted into the chat's
// conversation. The chat holds what the person typed, Jane's answers to it, and the cards they
// asked for there.

const message = (over: Partial<MessageView> = {}): MessageView => ({
  id: "m1",
  kind: "decision",
  fromJane: true,
  tag: "to decide",
  time: "Nov 24, 9:00 AM",
  body: "Delta Air Lines charged you $412.30\nIs this yours?",
  status: "open",
  answeredWith: null,
  note: null,
  advice: false,
  buttons: [{ id: "suggestion.yes", label: "Yes", kind: "primary" }],
  links: [],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: false,
  options: null,
  ...over,
});

describe("the chat holds only the conversation", () => {
  it("is what the person typed and Jane's answers, and nothing else", () => {
    expect([...CHAT_KINDS]).toEqual(["user", "reply"]);
    for (const kind of ["brief", "decision", "done", "heads_up"] as const) {
      expect(inChat(message({ kind }))).toBe(false);
    }
    expect(inChat(message({ kind: "user", fromJane: false }))).toBe(true);
    expect(inChat(message({ kind: "reply" }))).toBe(true);
  });

  it("leaves out every card Jane brought up unasked, open or answered, floating or not", () => {
    const unasked = [
      // The day's pick (the Delta one the founder saw).
      message({ id: "pick", suggestion: true }),
      // A finding card that isn't one of the day's picks, and so isn't in the dock's stack.
      message({ id: "finding", kind: "decision", buttons: [] }),
      // A change card and a heads-up, with and without a button.
      message({ id: "change", kind: "done", status: "answered", buttons: [] }),
      message({ id: "heads", kind: "heads_up", body: "Your Hulu renews tomorrow: $9.99." }),
      message({ id: "heads2", kind: "heads_up", buttons: [] }),
      // The day's brief.
      message({ id: "brief", kind: "brief", body: "Here's your week.", buttons: [] }),
      // Answered in the dock, with steps left to do.
      message({
        id: "diy",
        status: "answered",
        answeredWith: "Yes",
        buttons: [{ id: "diy.done", label: "Mark done", kind: "primary" }],
      }),
    ];
    expect(chatList(unasked, [])).toEqual([]);
    // With the dock's stack as it is, too.
    expect(chatList(unasked, dockOf(unasked))).toEqual([]);
  });

  it("keeps a card the person asked for there: cancel hulu's finding with Yes and No", () => {
    const typed = message({ id: "typed", kind: "user", fromJane: false, body: "cancel hulu" });
    const asked = message({
      id: "asked",
      kind: "reply",
      tag: "answer",
      body: "You pay Hulu $17.99 a month. Want me to note it to cancel?",
      buttons: [
        { id: "finding.yes", label: "Yes", kind: "primary" },
        { id: "finding.no", label: "No", kind: "secondary" },
      ],
    });
    const pick = message({ id: "pick", suggestion: true });
    expect(chatList([typed, pick, asked], dockOf([pick])).map((m) => m.id)).toEqual([
      "typed",
      "asked",
    ]);
  });

  it("leaves the dock's own stack as it was: the picks and cards still float there", () => {
    const pick = message({ id: "pick", suggestion: true });
    const heads = message({ id: "heads", kind: "heads_up", body: "Your Hulu renews tomorrow." });
    expect(dockOf([pick, heads]).map((m) => m.id)).toEqual(["pick", "heads"]);
  });
});
