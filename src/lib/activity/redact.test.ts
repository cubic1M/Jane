import { describe, expect, it } from "vitest";
import { cleanName, isPrivateField, normalizePath, redactText } from "./redact";

describe("redactText: what the activity log may keep of text on the page", () => {
  it.each([
    ["Cancel Netflix ($15.99/mo)", "Cancel Netflix (#/mo)"],
    ["Save $1,200 a year", "Save # a year"],
    ["Chase Checking ••1234", "Chase Checking ••#"],
    ["Card ending 4111 1111 1111 1111", "Card ending # # # #"],
    ["Email me at jo.doe+beta@example.com", "Email me at [email]"],
    ["12% APR", "# APR"],
    ["Due 10/31/2026", "Due #"],
    ["  Do it\n   myself  ", "Do it myself"],
  ])("%j → %j", (text, kept) => {
    expect(redactText(text)).toBe(kept);
  });

  it("cuts long text short", () => {
    const long = redactText("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("keeps only plain characters of a field or form name", () => {
    expect(cleanName('amount"><script>')).toBe("amount script");
    expect(cleanName("goal-name_2")).toBe("goal-name_#");
  });
});

describe("normalizePath", () => {
  it.each([
    ["/subscriptions?from=email", "/subscriptions"],
    ["/home#top", "/home"],
    ["/", "/"],
    ["/s/abc123def456ghi", "/s/:id"],
    ["/unsubscribe/eyJhbGciOiJIUzI1NiJ9xyzxyzxyz", "/unsubscribe/:id"],
    ["/report/cmabc12345", "/report/:id"],
    ["/life-events", "/life-events"],
    ["/settings/two-factor", "/settings/two-factor"],
  ])("%s → %s", (path, kept) => {
    expect(normalizePath(path)).toBe(kept);
  });
});

describe("isPrivateField", () => {
  it("is private when marked, whatever else", () => {
    expect(isPrivateField({ type: "text", markedPrivate: true })).toBe(true);
  });

  it.each([
    [{ type: "email" }],
    [{ type: "password" }],
    [{ type: "number" }],
    [{ type: "tel" }],
    [{ inputMode: "decimal" }],
    [{ autocomplete: "cc-number" }],
    [{ autocomplete: "name" }],
    [{ name: "amountCents" }],
    [{ name: "monthly_income" }],
    [{ name: "accountId" }],
    [{ name: "invite" }],
  ])("is private for %j", (field) => {
    expect(isPrivateField({ ...field, markedPrivate: false })).toBe(true);
  });

  it("is not private for a plain text field like the chat box", () => {
    expect(isPrivateField({ type: "text", name: "message", markedPrivate: false })).toBe(false);
    expect(isPrivateField({ markedPrivate: false })).toBe(false);
  });
});
