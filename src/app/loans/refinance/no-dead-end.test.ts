import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debug 2 (11-16): every real account's "Refinance" link, "See transfer offers" and "Refinance
// offers" opened this page, which said only "Offers come from a lending partner, and there isn't
// one for your accounts yet." Without a partner the page sends the person to the suggestion's own
// item on Loans, or the payoff plan (as /loans/interest does since #1865).

const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
const loans = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");

describe("the refinance page without a lending partner", () => {
  it("sends the person on before saying there's no partner", () => {
    expect(page).toMatch(/if \(!\(await lenderPartnerFor\(user\.id\)\)\) \{/);
    expect(page).toMatch(
      /redirect\(open \? `\/loans\?focus=\$\{loansTopicNode\(open\.topic\)\}` : "\/debt"\)/,
    );
  });

  it("isn't linked from Loans then", () => {
    expect(loans).toMatch(/\{refinanceOpen && \(/);
    expect(loans).not.toMatch(/<PageLink href="\/loans\/refinance" \/>/);
  });
});
