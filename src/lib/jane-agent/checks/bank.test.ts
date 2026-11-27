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

describe("the bank's patterns (CodeRabbit sweep)", () => {
  it("none has a doubled backslash before b, d or $ (it would match a literal backslash)", () => {
    const bad = QUESTIONS.flatMap((q) =>
      [q.expect.mentions, q.expect.avoid]
        .filter((r): r is RegExp => Boolean(r))
        .filter((r) => /\\\\[bd$]/.test(r.source))
        .map(() => q.id),
    );
    expect(bad).toEqual([]);
  });

  it("no pattern asks for a straight double quote inside a contraction", () => {
    const bad = QUESTIONS.filter((q) =>
      /\w"t\b/.test(`${q.expect.mentions?.source}${q.expect.avoid?.source}`),
    );
    expect(bad.map((q) => q.id)).toEqual([]);
  });

  it("an unrelated question is its own conversation, not a turn inside follow-2", () => {
    for (const id of ["unrelated-1", "unrelated-2"]) {
      expect(QUESTIONS.find((q) => q.id === id)?.after).toBeUndefined();
    }
  });

  // CodeRabbit part 2 (checks-02): the rows that said less than they asked.
  it("a payday answer needs the date as well as the employer", () => {
    const mentions = QUESTIONS.find((q) => q.id === "pay-1")!.expect.mentions!;
    expect(mentions.test("Your employer is Acme.")).toBe(false);
    expect(mentions.test("Your next pay from Acme lands on Dec 5.")).toBe(true);
    expect(mentions.test("Acme pays you on Friday.")).toBe(true);
    expect(mentions.test("Your next pay from Acme lands on December 5th.")).toBe(true);
  });

  it("the August follow-up must say August, and a mixed ask must offer its confirmation", () => {
    const august = QUESTIONS.find((q) => q.id === "follow-4b")!.expect.mentions!;
    expect(august.test("You spent $40.00 at Target.")).toBe(false);
    expect(august.test("In August you spent $40.00 at Target.")).toBe(true);
    expect(QUESTIONS.find((q) => q.id === "multi-2")!.expect.button).toBe("multi.confirm");
  });
});
