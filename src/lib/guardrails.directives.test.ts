import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// What a real account's chat answer could say with no word the lists knew (audit, 11-04). Until now
// only the prompt stopped these, and what code allows can't depend on Claude having listened.
const issues = (text: string) => {
  const check = checkGuardrails(text, [20_000]);
  return check.ok ? [] : check.issues;
};

describe("plain instructions in a chat answer", () => {
  it.each([
    ["You should buy Tesla now.", "investment_advice"],
    ["Sell Tesla today.", "investment_advice"],
    ["Put the extra in VOO.", "investment_advice"],
    ["Max out your HSA this year.", "investment_advice"],
    ["You should fund your 529 first.", "investment_advice"],
    ["Withhold your rent until they fix it.", "tax_or_legal_advice"],
    ["Stop paying rent until the landlord replies.", "tax_or_legal_advice"],
    ["I can't file this for you, but deduct the home office.", "tax_or_legal_advice"],
    [
      "I can't file this for you, but you can claim the home office as a loss.",
      "tax_or_legal_advice",
    ],
    ["Buy Nvidia and hold it.", "investment_advice"],
    ["Put the extra in VOO and VTI.", "investment_advice"],
    ["Put the extra in VOO for the long term.", "investment_advice"],
    ["Put the extra in VOO each month.", "investment_advice"],
    ["Move your savings to VOO.", "investment_advice"],
    ["Max your HSA this year.", "investment_advice"],
    ["Fill up your HSA first.", "investment_advice"],
    ["Contribute the max to your 529.", "investment_advice"],
    ["Put the max in your HSA.", "investment_advice"],
    ["Hold back your rent until they fix it.", "tax_or_legal_advice"],
    ["Skip rent until the landlord replies.", "tax_or_legal_advice"],
    ["Stop sending rent until they respond.", "tax_or_legal_advice"],
    ["Don't pay the landlord until they fix it.", "tax_or_legal_advice"],
    ["Pay your rent into escrow instead.", "tax_or_legal_advice"],
    ["I can't file this for you, however deduct the home office.", "tax_or_legal_advice"],
    ["I can't file this for you, so just deduct the home office.", "tax_or_legal_advice"],
    ["I can't file this for you, but do deduct the home office.", "tax_or_legal_advice"],
    ["I can't file this for you, but go ahead and deduct the home office.", "tax_or_legal_advice"],
    [
      "I can't file this for you, but take the deduction for your home office.",
      "tax_or_legal_advice",
    ],
  ])("stops %s", (text, issue) => {
    expect(issues(text)).toContain(issue);
  });

  it.each([
    "Buy Costco gas instead of the station by your office.",
    "You could sell the old couch.",
    "Put the $200.00 in PNC savings.",
    "Put it in USAA.",
    "Your HSA holds $200.00.",
    "You put $200.00 into your HSA in March.",
    "You stopped paying rent to Oak Street in June.",
    "Your rent is $200.00 this month.",
    "I can't help hide income from the IRS, but I can show you what came in.",
    // What a person's own money did, and things that only look like the lines above.
    "You have 3 Buy Now, Pay Later plans open.",
    "Klarna is a Buy Now, Pay Later service.",
    "You put $200.00 on your card for the trip in CA.",
    "If you move to a cheaper place in TX, your rent line changes.",
    "You put $200.00 into savings in OCT.",
    "Put the $200.00 in USD, not euros.",
    "Contributions to your 529 came to $200.00.",
    "Fund: your 529 holds $200.00.",
    "Your rent is due on the 1st, so don't pay rent early.",
    "Don't pay rent twice this month: the October payment already went out.",
    "If you stop paying rent to Sue from this account, the line drops.",
    "Stop paying Netflix to afford rent.",
    "Skip coffee to cover rent.",
    "I can't give tax advice, but you can report a wrong transaction to your bank.",
    "I can't give tax advice, but you can file a dispute with your card issuer.",
    "I can't give tax advice, but you can claim the refund from the merchant.",
  ])("leaves %s alone", (text) => {
    expect(issues(text)).toEqual([]);
  });
});
