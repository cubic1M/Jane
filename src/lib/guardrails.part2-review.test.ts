import { describe, expect, it } from "vitest";
import { checkGuardrails, linksElsewhere, misstatesDepositInsurance } from "./guardrails";

// CodeRabbit part 2 (guardrails.ts): four ways a reply got past a check.

const issuesOf = (text: string): string[] =>
  (checkGuardrails(text, []) as { issues?: string[] }).issues ?? [];

describe("a link the browser reads differently", () => {
  it("treats a backslash as the end of the host, as a browser does", () => {
    expect(linksElsewhere("Open https://evil.com\\@x.gov to see it.")).toHaveLength(1);
    expect(linksElsewhere("Open https://www.irs.gov/refunds to see it.")).toHaveLength(0);
  });
});

describe("a credential request with emphasis in it", () => {
  it("is still a request", () => {
    expect(issuesOf("Text your one-time **code** now.")).toContain("credential_request");
    expect(issuesOf("Never share your one-time code with anyone.")).not.toContain(
      "credential_request",
    );
  });

  it("is still a request when a warning sits on the line above", () => {
    expect(issuesOf("Never share your PIN\n👉 Send your password here.")).toContain(
      "credential_request",
    );
  });
});

describe("Jane said to be federally insured", () => {
  it("is blocked like FDIC insured", () => {
    expect(misstatesDepositInsurance("Jane is federally insured.")).toBe(true);
    expect(misstatesDepositInsurance("Your Jane balance is federally insured.")).toBe(true);
    expect(misstatesDepositInsurance("Jane is not federally insured.")).toBe(false);
  });
});

describe("a dispute said to be sent", () => {
  it("is blocked as a claim of something done, in the plain past too", () => {
    expect(issuesOf("I submitted your dispute this morning.")).toContain("claimed_action");
  });
});
