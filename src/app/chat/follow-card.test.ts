import { describe, expect, it, vi } from "vitest";

const { tapButton } = vi.hoisted(() => ({ tapButton: vi.fn() }));
vi.mock("./actions", () => ({ tapButton, noteDetailsOpened: vi.fn() }));
vi.mock("@/lib/dock-gone", async (real) => ({
  ...(await real<typeof import("@/lib/dock-gone")>()),
  markGone: vi.fn(),
}));

import { markGone } from "@/lib/dock-gone";
import { followCard } from "./suggestion-cards";

// Founder (11-12): "when you click open details or open or whatever for the suggestion box, that
// box just disappears and you get sent to the page with the details, i don't want that". Following
// a card's link opens the page and leaves the card where it was: never an answer, never gone. A
// suggestion only notes it was looked at (its outcome's openedAt).

const suggestion = { id: "m1", suggestion: true };
const other = { id: "m2", suggestion: false };

function follow(
  message: { id: string; suggestion: boolean } | undefined,
  href: string,
  onPage = true,
) {
  const push = vi.fn();
  const noteOpened = vi.fn();
  const handled = followCard(message, href, { push, noteOpened, onPage });
  return { handled, push, noteOpened };
}

describe("following a card's link", () => {
  it("opens a suggestion's page on the page itself and notes it was looked at", () => {
    const { handled, push, noteOpened } = follow(suggestion, "/subscriptions?from=m1");
    expect(handled).toBe(true);
    expect(push).toHaveBeenCalledWith("/subscriptions?from=m1");
    expect(noteOpened).toHaveBeenCalledWith("m1");
  });

  it("opens another card's page without noting anything", () => {
    const { handled, push, noteOpened } = follow(other, "/insurance?from=m2");
    expect(handled).toBe(true);
    expect(push).toHaveBeenCalledWith("/insurance?from=m2");
    expect(noteOpened).not.toHaveBeenCalled();
  });

  it("leaves the chat's frame to its bridge, which opens the page", () => {
    const { handled, push, noteOpened } = follow(suggestion, "/subscriptions", false);
    expect(handled).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(noteOpened).toHaveBeenCalledWith("m1");
  });

  it("lets a link off the site go as links do", () => {
    const { handled, push } = follow(other, "https://www.irs.gov/forms");
    expect(handled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("never answers the card nor takes it off the stack, whatever the link", () => {
    follow(suggestion, "/subscriptions");
    follow(other, "/insurance");
    follow(suggestion, "/subscriptions", false);
    follow(undefined, "/money");
    expect(tapButton).not.toHaveBeenCalled();
    expect(markGone).not.toHaveBeenCalled();
  });
});
