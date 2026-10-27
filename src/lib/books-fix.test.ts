import { describe, expect, it } from "vitest";
import { booksFix, importEnded } from "./books-fix";

const issue = (kind: string, accountId: string | null, itemId: string | null) => ({
  kind,
  accountId,
  itemId,
});

describe("booksFix", () => {
  it("sends an import that ended to a newer file, not a reconnect", () => {
    expect(importEnded(issue("stale", "acc", null))).toBe(true);
    expect(booksFix(issue("stale", "acc", null))).toEqual({
      label: "Import a newer file",
      href: "/import",
    });
  });

  it("sends a lapsed sign-in to Reconnect", () => {
    expect(booksFix(issue("broken", null, "item"))).toEqual({
      label: "Reconnect",
      href: "/connect",
    });
  });

  it("sends a transfer with no other side to linking that account", () => {
    expect(booksFix(issue("transfer", "acc", null)).label).toBe("Link that account");
  });

  it("sends a bank's own problems to its bank in Settings", () => {
    for (const i of [
      issue("stale", null, "item"),
      issue("off", "acc", null),
      issue("gap", "acc", null),
      issue("duplicate", "acc", null),
    ]) {
      expect(importEnded(i)).toBe(false);
      expect(booksFix(i)).toEqual({ label: "Check my linked banks", href: "/settings#banks" });
    }
  });
});

describe("booksFix for uploaded accounts", () => {
  it("sends a balance that doesn't add up to the uploads, not to linked banks", () => {
    for (const kind of ["off", "gap", "duplicate"]) {
      expect(booksFix({ ...issue(kind, "acc", null), uploaded: true })).toEqual({
        label: "Check my uploads",
        href: "/import",
      });
    }
    // An ended file still asks for a newer one.
    expect(booksFix({ ...issue("stale", "acc", null), uploaded: true }).label).toBe(
      "Import a newer file",
    );
  });
});
