import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 46 (11-15): a lease read for the person and things left off an application, on
// any account; a pick behind a disclaimer and skipping a tax return, on a real account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("leases and applications on any account", () => {
  it.each([
    "You can sublet without telling your landlord.",
    "Your lease probably lets you sublet.",
    "You can sublease without permission.",
    "A sublet without asking breaks most leases.",
    "Legally they probably can't do that.",
    "Your landlord doesn't need to know.",
    "Don't mention the side job on the application.",
    "Leave the side income off the loan application.",
    "Round up your income on the application.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("a disclaimer or a skipped return on a real account", () => {
  it.each(["This isn't advice, but I'd sell.", "You could probably skip filing this year."])(
    "blocks %s",
    (text) => {
      expect(real(text).ok).toBe(false);
    },
  );
});

describe("what still passes on a real account", () => {
  it.each([
    "Your sublet rent of $400.00 arrived Nov 1.",
    "Your subletter paid $400.00 on Nov 1.",
    "Put your new address on the application.",
    "List your income on the application.",
    "Legally Blonde is on Netflix tonight.",
    "Your Netflix plan doesn't need to change.",
    "Your bank doesn't need anything else from you.",
    "Not sure, but I think your Hulu renews Dec 1.",
    "You're filing your expense report late.",
    "If I were you, I'd call Comcast first.",
    "Most people in your spot cancel one streaming service.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
