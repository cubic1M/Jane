import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TABS } from "./navigation";

// Debugger 11-14: on a phone, the "Loans & credit" tab opened a page headed "Every debt" (its name
// from step 109, before the area pages), with "Loans & credit" again at the root of its tree. An
// area's page is headed with its tab's name, so a tap lands where it said.

// Tabs whose page heading is something else, for now, with why.
const OTHER_HEADINGS: Record<string, string> = {
  // Its own page, not an area page.
  chat: "the chat",
  // Home's hub has no heading of its own.
  today: "Home",
  // In the profile menu, not an area: headed with what Jane is doing, which depends on the person.
  jane: "What Jane is doing for you",
  // "Investing (practice)" opens "Investments": left for the founder (debugger 11-14).
  investments: "Investments",
};

const headingOf = (href: string) => {
  const source = readFileSync(join(__dirname, "..", "app", href, "page.tsx"), "utf8");
  return /<h1[^>]*>([^<{]*)/.exec(source)?.[1]?.replace(/&amp;/g, "&").trim() ?? null;
};

describe("an area's page", () => {
  it("is headed with its tab's name", () => {
    const off = TABS.filter((tab) => !(tab.key in OTHER_HEADINGS)).flatMap((tab) => {
      const heading = headingOf(tab.href);
      return heading?.startsWith(tab.label) ? [] : [`${tab.label}: ${heading}`];
    });
    expect(off).toEqual([]);
  });
});
