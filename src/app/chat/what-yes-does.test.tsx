import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ tapButton: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { MessageView } from "@/lib/jane-agent/view";
import { cardOf, stepAfterYes } from "./suggestion-cards";

// Debugger 11-12: since #1615 Yes on a suggestion opens the step Jane prepared, but the card's
// "What Yes does" still said "Yes puts it on your list; Open takes you to the page". The words
// say what the button does.

const card = (): MessageView =>
  ({
    id: "m1",
    kind: "decision",
    fromJane: true,
    tag: "to decide",
    time: "Nov 12, 9:00 AM",
    body: "Drop your mortgage insurance, save $1,562/yr\nWhy you: Your mortgage carries PMI.\n83% sure: 1 mortgage record in 12 months of data.",
    status: "open",
    answeredWith: null,
    note: null,
    suggestion: true,
    buttons: [
      { id: "suggestion.yes", label: "See if PMI can go", kind: "primary" },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ],
    links: [{ label: "Open", href: "/loans" }],
  }) as unknown as MessageView;

describe("what Yes does, as the card says it", () => {
  it("is what the button does: opens the step, buys and moves nothing", () => {
    const text = cardOf(card()).details.whatYesDoes ?? "";
    expect(text).toMatch(/^See if PMI can go\. /);
    expect(text).toMatch(/Yes opens the page where you do it/);
    expect(text).toMatch(/Nothing is bought or moved/);
    expect(text).not.toMatch(/puts it on your list/);
  });

  it("matches Yes, which goes to the step its answer links", () => {
    const answered = {
      error: null,
      message: { links: [{ label: "Open it", href: "/loans?focus=cheaper" }] },
    };
    expect(stepAfterYes(answered as never)).toBe("/loans?focus=cheaper");
  });
});
