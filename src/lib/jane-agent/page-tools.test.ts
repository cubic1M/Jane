import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { QUESTIONS } from "./checks/bank";
import { CHAT_TOOLS } from "./claude-tools";
import { PAGE_TOOLS } from "./page-tools";

// Spec step 192: every page of the app can be asked about in the chat, from a tool that
// reads it, and has a bank question that reaches one of its tools.

const tools = new Set(CHAT_TOOLS.map((t) => t.name));
const NOT_ASKABLE = new Set([
  "admin",
  "api",
  "favicon.ico",
  "goodbye",
  "icons",
  "login",
  "mfa",
  "offline",
  "privacy",
  "report-a-problem",
  "s",
  "scanning",
  "security",
  "settings",
  "signup",
  "terms",
  "try",
  "unsubscribe",
  "chat",
]);
const pages = readdirSync(join(process.cwd(), "src/app")).filter(
  (name) =>
    statSync(join(process.cwd(), "src/app", name)).isDirectory() &&
    !NOT_ASKABLE.has(name) &&
    !name.startsWith("("),
);

describe("a tool for every page", () => {
  it("lists every page of the app, and only pages", () => {
    expect(pages.filter((p) => !PAGE_TOOLS[p])).toEqual([]);
    expect(Object.keys(PAGE_TOOLS).filter((p) => !pages.includes(p))).toEqual([]);
  });

  it("names only tools Claude has", () => {
    for (const [page, names] of Object.entries(PAGE_TOOLS)) {
      expect(names.length, page).toBeGreaterThan(0);
      for (const name of names) expect(tools.has(name), `${page} -> ${name}`).toBe(true);
    }
  });

  it("has a bank question for each page that reaches one of its tools", () => {
    for (const [page, names] of Object.entries(PAGE_TOOLS)) {
      const asked = QUESTIONS.filter(
        (q) => q.page === `/${page}` || q.page?.startsWith(`/${page}/`),
      );
      expect(
        asked.some((q) => q.tool && names.includes(q.tool)),
        `no bank question reaches ${page}'s tools`,
      ).toBe(true);
    }
  });
});
