import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOAN_LINKS, loanLinksFor } from "./loan-links";

// Every loan link is plain and unpaid (connectors roadmap rounds 14 and 15), and so is every URL
// written anywhere in src/config.

// Query parameters affiliate networks use to tag a click, or that would carry the person.
const TAGGING =
  /^(?:aff(?:iliate)?(?:_?id)?|aff_sub\d?|subid\d?|sub_?id\d?|sid|clickref|clickid|click_?id|irclickid|irgwc|cjevent|awc|ranMID|ranEAID|ranSiteID|tag|ref(?:id)?|referrer|partner(?:_?id)?|pid|utm_\w+|fobs\d?|p\.\w+|sharedid|email|e?mail|name|phone|zip|dob|ssn|user(?:_?id)?|uid)$/i;

const tagged = (url: string): string[] =>
  [...new URL(url).searchParams.keys()].filter((name) => TAGGING.test(name));

describe("the loan link registry", () => {
  it("is unpaid, https, and carries no affiliate tag or anything about the person", () => {
    for (const link of LOAN_LINKS) {
      expect(link.paid, link.id).toBe(false);
      if (link.url === null) continue;
      expect(link.url, link.id).toMatch(/^https:\/\//);
      expect(tagged(link.url), link.id).toEqual([]);
      // Plain links: no query string at all.
      expect(new URL(link.url).search, link.id).toBe("");
    }
    expect(new Set(LOAN_LINKS.map((l) => l.id)).size).toBe(LOAN_LINKS.length);
  });

  it("gives a real account the government pages, never a named lender", () => {
    const real = loanLinksFor("student_refinance", { adviceMode: false });
    expect(real.filter((l) => l.kind === "lender")).toEqual([]);
    expect(loanLinksFor("student_refinance", { adviceMode: true }).length).toBeGreaterThan(0);
    expect(loanLinksFor("student_federal", { adviceMode: false }).map((l) => l.kind)).toEqual(
      expect.arrayContaining(["government"]),
    );
    // A marketplace without its address isn't shown.
    expect(loanLinksFor("auto_refinance", { adviceMode: true })).toEqual([]);
  });
});

describe("every URL in src/config", () => {
  it("carries no affiliate tag and nothing about the person", () => {
    const dir = "src/config";
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const [url] of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) {
        let found: string[];
        try {
          found = tagged(url);
        } catch {
          continue;
        }
        if (found.length > 0) offenders.push(`${file}: ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
