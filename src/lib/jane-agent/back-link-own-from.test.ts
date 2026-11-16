import { describe, expect, it } from "vitest";
import { withFrom } from "./back-link";

// Debugger 11-16 (a Plaid sandbox student): Yes on "Confirm 1 charge to close October: $20" opened
// /transactions?from=2026-10-01&to=2026-10-31&from=<message id>. The page's own date and the chat's
// message id shared one name, the dates were lost, and the list showed November first. A page that
// already uses ?from= keeps it.

describe("a link from one of Jane's messages", () => {
  it("leaves a page's own ?from= alone", () => {
    expect(withFrom("/transactions?from=2026-10-01&to=2026-10-31", "cmwioteer0066")).toBe(
      "/transactions?from=2026-10-01&to=2026-10-31",
    );
  });

  it("still carries the message's id to every other page", () => {
    expect(withFrom("/loans/costly", "cmwioteer0066")).toBe("/loans/costly?from=cmwioteer0066");
    expect(withFrom("/transactions?day=2026-10-12", "cmwioteer0066")).toBe(
      "/transactions?day=2026-10-12&from=cmwioteer0066",
    );
  });
});
