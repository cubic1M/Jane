import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { CHAT_TOOLS } from "../claude-tools";
import { QUESTIONS } from "./bank";

// Spec step 189: the question bank is big enough and covers every sector and every page.

const tools = new Set(CHAT_TOOLS.map((t) => t.name));
// Pages with nothing to ask about: sign-in, legal, the admin area, redirects and plumbing.
const NOT_ASKABLE = new Set([
  "accountant",
  "admin",
  "gift",
  "api",
  "goodbye",
  "icons",
  "join",
  "login",
  "mfa",
  "offline",
  "privacy",
  "report-a-problem",
  "s",
  "scanning",
  "security",
  "signup",
  "terms",
  "try",
  "unsubscribe",
]);

describe("the question bank", () => {
  it("has at least 400 everyday questions with their own ids", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(400);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    expect(new Set(QUESTIONS.map((q) => q.text.toLowerCase())).size).toBeGreaterThanOrEqual(400);
  });

  it("names a tool Claude has for every question that says which", () => {
    for (const q of QUESTIONS.filter((q) => q.tool)) {
      expect(tools.has(q.tool!), `${q.id} "${q.text}" -> ${q.tool}`).toBe(true);
    }
  });

  it("has questions for every page of the app", () => {
    const covered = new Set(QUESTIONS.map((q) => q.page?.split("/")[1]).filter(Boolean));
    const pages = readdirSync(join(process.cwd(), "src/app")).filter(
      (name) =>
        statSync(join(process.cwd(), "src/app", name)).isDirectory() && !NOT_ASKABLE.has(name),
    );
    const missing = pages.filter(
      (p) => !covered.has(p) && !["chat", "settings"].includes(p) && !p.startsWith("("),
    );
    expect(missing).toEqual([]);
  });

  it("has questions for every sector", () => {
    const sectors = new Set(QUESTIONS.map((q) => q.sector));
    for (const s of [
      "bills",
      "subs",
      "spending",
      "budgets",
      "goals",
      "networth",
      "moving",
      "debt",
      "loans",
      "student",
      "credit",
      "insurance",
      "taxes",
      "investing",
      "hsa",
      "giving",
      "settings",
      "help",
      "life",
      "income",
      "household",
      "two",
      "typos",
      "edge",
    ]) {
      expect(sectors.has(s), s).toBe(true);
    }
  });

  it("includes the questions the QA report found unanswered", () => {
    const texts = QUESTIONS.map((q) => q.text);
    for (const t of [
      "what's my net worth",
      "why is my checking going negative",
      "what about my HSA",
      "move $200 to savings",
    ]) {
      expect(texts).toContain(t);
    }
  });
});
