import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-13, the chat on a phone: after a message, the cards fold to one line, and the
// small-phone rule for that line (the very bottom, beside Home's Jane button) beat the chat's own
// rule: the build joins its two selectors into one :is(), which takes #jane-fab's weight for both.
// So the line sat on the message box. That rule now leaves the chat out, and the chat's rule puts
// the line above the box (e2e/chat-fold-clear-of-box.spec.ts checks it on the page).

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("the chat's folded card line", () => {
  it("isn't put at the very bottom by the small phone's rule", () => {
    // The folded line's own rule: bottom beside the Jane button, and clear of it on the right.
    const phone =
      /([^{}]+)\{\s*bottom: calc\(1rem \+ 6px \+ env\(safe-area-inset-bottom\)\);\s*right: 5\.5rem;/.exec(
        css,
      )?.[1] ?? "";
    const selectors = phone
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toContain(":not(:has([data-chat-composer]))");
  });

  it("is put above the message box in the chat", () => {
    expect(css).toMatch(
      /body:has\(\[data-chat-composer\]\) \.floating-cards \{\s*bottom: calc\(var\(--chat-composer-h/,
    );
  });
});
