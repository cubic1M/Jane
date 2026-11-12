import { describe, expect, it } from "vitest";
import {
  chatList,
  concise,
  firstSentence,
  hiddenBrief,
  isPopup,
  popupCard,
  popupStack,
  withoutPopups,
  POPUP_HEADLINE_WORDS,
} from "./popups";
import type { MessageView } from "./view";

// Jane's own messages as pop-ups: what floats, how short its headline is, what its buttons do.

const message = (over: Partial<MessageView> = {}): MessageView => ({
  id: "m1",
  kind: "decision",
  fromJane: true,
  tag: "to decide",
  time: "Oct 24, 9:00 AM",
  body: "How much should I do on my own?\nHandle the safe stuff: refunds and fees.",
  status: "open",
  answeredWith: null,
  note: null,
  advice: false,
  buttons: [
    { id: "autopilot.safe", label: "Handle the safe stuff", kind: "primary" },
    { id: "autopilot.all", label: "Handle everything allowed", kind: "secondary" },
    { id: "autopilot.ask", label: "Ask me first", kind: "secondary" },
  ],
  links: [],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: false,
  options: null,
  ...over,
});

describe("what floats", () => {
  it("floats Jane's own open messages with a button, never its answers or what's done", () => {
    expect(isPopup(message())).toBe(true);
    expect(isPopup(message({ kind: "reply" }))).toBe(false);
    expect(isPopup(message({ status: "answered" }))).toBe(false);
    expect(isPopup(message({ buttons: [] }))).toBe(false);
    expect(isPopup(message({ fromJane: false, kind: "user" }))).toBe(false);
    // Only Undo left: it's history, in the list.
    expect(
      isPopup(message({ buttons: [{ id: "undo.no", label: "Undo", kind: "secondary" }] })),
    ).toBe(false);
  });

  it("leaves no gap in the list where a pop-up came from", () => {
    const a = message({ id: "a" });
    const b = message({ id: "b", kind: "reply", buttons: [] });
    expect(withoutPopups([a, b], [a]).map((m) => m.id)).toEqual(["b"]);
  });
});

describe("a pop-up's card", () => {
  it("has a headline of eight words at most, cut at a word", () => {
    expect(concise("Cancel Hulu, save $216/yr")).toBe("Cancel Hulu, save $216/yr");
    const long = concise("Your car insurance renews next week and the price went up by $240");
    expect(long.split(" ").length).toBeLessThanOrEqual(POPUP_HEADLINE_WORDS);
    expect(long).toBe("Your car insurance renews next week and the…");
  });

  it("taps the main button for Yes, puts the others behind More details, and snoozes on Not now", () => {
    const card = popupCard(message());
    expect(card).toMatchObject({
      headline: "How much should I do on my own?",
      yesLabel: "Handle the safe stuff",
      yesAction: "autopilot.safe",
      notNowAction: null,
      choices: [
        { id: "autopilot.all", label: "Handle everything allowed" },
        { id: "autopilot.ask", label: "Ask me first" },
      ],
    });
    expect(card.details.about).toBe("Handle the safe stuff: refunds and fees.");
    const heads = popupCard(
      message({
        kind: "heads_up",
        body: "Your rent is due Friday.",
        buttons: [
          { id: "deadline.done", label: "Paid it", kind: "primary" },
          { id: "snooze", label: "Remind me later", kind: "secondary" },
        ],
      }),
    );
    expect(heads).toMatchObject({
      yesAction: "deadline.done",
      notNowAction: "snooze",
      notNowLabel: "Remind me later",
      choices: [],
    });
    expect(heads.details.confidence).toBeUndefined();
  });

  it("shows a heads-up's confidence behind More details", () => {
    const card = popupCard(
      message({
        kind: "heads_up",
        body: "Netflix went up from $15.49 to $17.99. If you didn't expect that, take a look.",
        confidence: { percent: 84, reason: "3 earlier charges in 11 months of data" },
      }),
    );
    expect(card.details.confidence).toEqual({
      percent: 84,
      reason: "3 earlier charges in 11 months of data",
    });
  });

  it("shows its first sentence whole, never cut with an ellipsis, and the rest behind More details", () => {
    const body = "Your car insurance renews next week and the price went up by $240";
    expect(popupCard(message({ body })).headline).toBe(body);
    expect(popupCard(message({ body })).details.about).toBeUndefined();
    const brief = popupCard(
      message({
        kind: "brief",
        body: "Good morning! Three things today.\nYour rent is due Friday.",
      }),
    );
    expect(brief.headline).toBe("Good morning!");
    expect(brief.details.about).toBe("Three things today.\nYour rent is due Friday.");
    expect(firstSentence("Saved $3.50 a month. More soon.")).toBe("Saved $3.50 a month.");
  });
});

describe("one stack of cards, never repeated", () => {
  const suggestion = (id: string, body: string) => message({ id, body, suggestion: true });

  it("puts the day's suggestions first, then the rest, one card per message and per headline", () => {
    const stack = popupStack(
      [suggestion("s1", "Drop your mortgage insurance, save $1,562/yr\nWhy you: …")],
      [
        message({ id: "s1", suggestion: true }),
        message({
          id: "d1",
          body: "Drop your mortgage insurance, save $1,562/yr\nFrom insurance.",
        }),
        message({ id: "d2" }),
        message({ id: "b1", kind: "brief", body: "Here's your week." }),
        // The morning greeting is off for now (MORNING_BRIEF): never a card.
        message({ id: "g1", kind: "brief", body: "Good morning! Three things today." }),
      ],
      12,
    );
    expect(stack.map((m) => m.id)).toEqual(["s1", "b1", "d2"]);
  });

  it("keeps no more than the limit beyond the suggestions", () => {
    const others = ["a", "b", "c"].map((id) => message({ id, body: `Thing ${id}` }));
    expect(popupStack([], others, 2)).toHaveLength(2);
  });

  it("keeps the cards out of the chat: no suggestion, waiting or answered, and no twin", () => {
    const stack = [suggestion("s1", "Cancel Hulu, save $216/yr")];
    const list = chatList(
      [
        suggestion("s1", "Cancel Hulu, save $216/yr"),
        message({ id: "s0", suggestion: true, status: "answered" }),
        message({ id: "twin", body: "Cancel Hulu, save $216/yr\nFrom spending." }),
        message({ id: "r1", kind: "reply", body: "Here's your plan." }),
        message({ id: "old", body: "Cancel Hulu, save $216/yr", status: "answered", buttons: [] }),
      ],
      stack,
    );
    expect(list.map((m) => m.id)).toEqual(["r1"]);
  });

  // Founder (11-11): "after the user interacts with the suggestion, it should just disappear and
  // not leave like a trace in the chatbot". The list is read from the server, so a reload agrees.
  it("leaves no trace of a card once it's answered or put away", () => {
    const answered = [
      message({ id: "yes", status: "answered", answeredWith: "Yes", buttons: [] }),
      message({ id: "no", status: "dismissed", buttons: [] }),
      // An Undo, a Revert or a Done isn't something left to do.
      message({
        id: "undo",
        status: "answered",
        answeredWith: "No",
        buttons: [{ id: "undo.no", label: "Undo", kind: "secondary" }],
      }),
      message({
        id: "chosen",
        status: "answered",
        buttons: [
          { id: "choice.revert", label: "Revert", kind: "secondary" },
          { id: "choice.done", label: "Done", kind: "secondary" },
        ],
      }),
    ];
    expect(chatList(answered, [])).toEqual([]);
    // Its answer to a typed question stays: that's the conversation, not a card.
    const reply = message({ id: "reply", kind: "reply", status: "answered", buttons: [] });
    expect(chatList([reply], []).map((m) => m.id)).toEqual(["reply"]);
  });

  it("keeps a real account's Yes while its steps wait on Mark done, then lets it go", () => {
    const steps = message({
      id: "diy",
      kind: "decision",
      status: "answered",
      answeredWith: "Yes",
      note: "Here's how to do it yourself:\n1. Call them.\nTap Mark done once it's done.",
      buttons: [{ id: "diy.done", label: "Mark done", kind: "primary" }],
    });
    expect(chatList([steps], []).map((m) => m.id)).toEqual(["diy"]);
    expect(chatList([{ ...steps, buttons: [] }], [])).toEqual([]);
  });
});

describe("the morning greeting, off for now", () => {
  it("hides a greeting brief while it's off, and only that", () => {
    const greeting = message({ kind: "brief", body: "Good afternoon! $2,710 safe to spend." });
    expect(hiddenBrief(greeting)).toBe(true);
    expect(hiddenBrief(greeting, true)).toBe(false);
    expect(hiddenBrief(message({ kind: "brief", body: "Here's your week." }))).toBe(false);
    // The first-run hello is gone for good, whatever the flag.
    const hello = message({ kind: "brief", body: "Hi, I'm Jane. I look at your money every day." });
    expect(hiddenBrief(hello)).toBe(true);
    expect(hiddenBrief(hello, true)).toBe(true);
    expect(hiddenBrief(message({ kind: "decision", body: "Good morning! Not a brief." }))).toBe(
      false,
    );
    expect(chatList([greeting], []).length).toBe(0);
  });
});

describe("a card whose only button is its snooze", () => {
  it("shows it once, as Yes, with a plain Not now", () => {
    const card = popupCard(
      message({
        kind: "heads_up",
        body: "Coming up in 2 days: your card payment ($72.00).",
        buttons: [{ id: "snooze", label: "Remind me tomorrow", kind: "secondary" }],
      }),
    );
    expect(card).toMatchObject({
      yesLabel: "Remind me tomorrow",
      yesAction: "snooze",
      notNowLabel: "Not now",
      notNowAction: null,
    });
  });
});

describe("a card whose only button is a plain Not now", () => {
  const body = "Costly short-term borrowing cost you $140.00 over the last year.";
  const snooze = { id: "snooze" as const, label: "Not now", kind: "secondary" as const };

  it("leads with its page, and Not now puts it off, so never the same button twice", () => {
    const card = popupCard(
      message({
        kind: "heads_up",
        body,
        buttons: [snooze],
        links: [{ label: "Your costly borrowing", href: "/loans/costly" }],
      }),
    );
    expect(card).toMatchObject({
      yesLabel: "Your costly borrowing",
      yesHref: "/loans/costly",
      notNowLabel: "Not now",
      notNowAction: "snooze",
    });
  });

  it("says Got it when there's no page to go to", () => {
    const card = popupCard(message({ kind: "heads_up", body, buttons: [snooze], links: [] }));
    expect(card).toMatchObject({ yesLabel: "Got it", yesAction: "snooze", notNowLabel: "Not now" });
    expect(card.yesHref).toBeUndefined();
  });

  it("keeps a button of its own first when it has one", () => {
    const card = popupCard(
      message({
        buttons: [{ id: "finding.yes", label: "Confirm", kind: "primary" }, snooze],
        links: [{ label: "See it", href: "/insurance" }],
      }),
    );
    expect(card).toMatchObject({ yesLabel: "Confirm", yesAction: "finding.yes" });
    expect(card.yesHref).toBeUndefined();
  });
});

describe("advice on a card's face", () => {
  it("carries the label there, not behind More details", () => {
    const card = popupCard(
      message({
        advice: true,
        buttons: [{ id: "finding.yes", label: "Confirm", kind: "primary" }],
      }),
    );
    expect(card.badge).toBe("Demo advice: sample data, not financial advice");
    expect(card.details.notes).toBeUndefined();
  });

  it("has no label on anything else", () => {
    const card = popupCard(
      message({ buttons: [{ id: "finding.yes", label: "Confirm", kind: "primary" }] }),
    );
    expect(card.badge).toBeUndefined();
  });
});

describe("a card with no main button of its own", () => {
  const gap = (over: Partial<MessageView> = {}) =>
    message({
      kind: "heads_up",
      body: "No renters insurance on file. Your payments show rent.",
      buttons: [
        { id: "insurance.gap_no", label: "I don't need it", kind: "secondary" },
        { id: "snooze", label: "Not now", kind: "secondary" },
      ],
      links: [{ label: "I have renters insurance", href: "/insurance?add=renters#add" }],
      ...over,
    });

  it("leads with its page, never with a secondary answer that can't be taken back", () => {
    expect(popupCard(gap())).toMatchObject({
      yesLabel: "I have renters insurance",
      yesHref: "/insurance?add=renters#add",
      // A swipe right only puts it off.
      yesAction: "snooze",
      notNowLabel: "Not now",
      notNowAction: "snooze",
      choices: [{ id: "insurance.gap_no", label: "I don't need it" }],
    });
  });

  it("keeps a primary button first when it has one", () => {
    const card = popupCard(
      gap({
        buttons: [
          { id: "insurance.gap_quotes", label: "Get quotes", kind: "primary" },
          { id: "insurance.gap_no", label: "I don't need it", kind: "secondary" },
          { id: "snooze", label: "Not now", kind: "secondary" },
        ],
      }),
    );
    expect(card).toMatchObject({ yesLabel: "Get quotes", yesAction: "insurance.gap_quotes" });
    expect(card.yesHref).toBeUndefined();
  });
});
