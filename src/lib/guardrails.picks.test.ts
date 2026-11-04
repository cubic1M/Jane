import { describe, expect, it } from "vitest";
import { checkGuardrails, splitByGuardrails } from "./guardrails";

// Which company or fund to own, however it's put (debugger's round 150, 11-04: "I'd buy Apple over
// Microsoft", "Get into VTI now"). What code allows can't depend on Claude having listened, and a
// blocked sentence is dropped from the answer, so everyday money sentences have to stay.
const adviceIn = (text: string) => {
  const check = checkGuardrails(text, [20_000, 999, 1_549]);
  return !check.ok && check.issues.includes("investment_advice");
};

describe("a pick of what to own", () => {
  it.each([
    "I'd buy Apple over Microsoft.",
    "I would buy Apple instead of Microsoft.",
    "Buy Apple rather than Microsoft.",
    "Sell Tesla and buy Ford.",
    "Get into VTI now.",
    "Get into Apple now.",
    "I'd get into Nvidia this year.",
    "Go with VTI.",
    "I'd go with VOO over VTI.",
    "Pick VTI.",
    "Choose VOO for this.",
    "Grab some VTI.",
    "Grab some Nvidia.",
    "Pick up some AAPL.",
    "Pick up some Tesla.",
    "Load up on Tesla.",
    "Load up on NVDA.",
    "Pile into Nvidia.",
    "Buy into Apple.",
    "Start with VOO.",
    "Stick with VTI.",
    "Stay in VTI.",
    "Go long NVDA.",
    "Go long on Tesla.",
    "Get out of VTI.",
    "Get out of Tesla now.",
    "Cash out of Apple.",
    "Bet on Nvidia.",
    "VTI is the better pick.",
    "VOO is a good buy.",
    "Apple is a better buy than Microsoft.",
    "Nvidia is a strong buy.",
    "Tesla is overvalued.",
    "AAPL looks undervalued.",
    "Tesla looks like a buy.",
    "Hold Nvidia.",
    "Own more Tesla.",
    "Trim VTI this year.",
    "Add to VOO each month.",
    "My top pick is Apple.",
    "My pick would be VTI.",
  ])("stops %s", (text) => {
    expect(adviceIn(text), text).toBe(true);
  });
});

describe("everyday money", () => {
  it.each([
    "You have 3 Buy Now, Pay Later plans open.",
    "Contributions to your 529 came to $200.00.",
    "You paid Apple $9.99 on Oct 3.",
    "Apple charged you $9.99.",
    "Your Apple subscription is $9.99 a month.",
    "You bought Apple Music in October.",
    "Tesla charged you $15.49 for charging.",
    "You spent $200.00 at Costco.",
    "Costco is a better buy than Safeway.",
    "Costco is a good buy for groceries.",
    "I'd buy groceries at Costco over Safeway.",
    "Buy Costco gas instead of Shell.",
    "I'd buy a Honda over a Toyota.",
    "Buy a TV with the refund.",
    "Get into a CD for that cash.",
    "Get into the habit of checking.",
    "Get into HYSA savings.",
    "Get into Medicare before your birthday.",
    "Get out of your Verizon contract.",
    "Get out of the Planet Fitness membership.",
    "Get out of debt first.",
    "Get out of PMI once you hit 20%.",
    "Go with GEICO if the quote holds.",
    "Go with a cheaper plan.",
    "Go with Chase for the card.",
    "Pick USAA for the loan.",
    "Pick a due date after payday.",
    "Choose ACH for the payment.",
    "Grab some Trader Joes.",
    "Grab some groceries.",
    "Pick up some Costco gas.",
    "Load up on groceries at Costco.",
    "Stick with Verizon.",
    "Stick with your budget.",
    "Stay in CA for the trip.",
    "Start with HSBC.",
    "Start with the card.",
    "Your home isn't overvalued on the tax bill.",
    "A used car that's overvalued costs more to insure.",
    "Stick with AT&T for now.",
    "Hold Chase to the refund.",
    "Own your budget.",
    "Trim the Hulu plan.",
    "Add to your savings each month.",
    "Add to HYSA savings.",
    "My pick would be the cheaper plan.",
    "Your best choice is GEICO.",
    "You own a Ford.",
  ])("lets through %s", (text) => {
    expect(adviceIn(text), text).toBe(false);
  });
});

describe("around a pick", () => {
  it.each([
    "I can't tell you whether to buy Apple over Microsoft.",
    "I can't recommend VTI or say what to invest in.",
  ])("lets a refusal say what it won't do: %s", (text) => {
    expect(adviceIn(text), text).toBe(false);
  });

  it("drops the pick and keeps the fact beside it", () => {
    const { kept, dropped } = splitByGuardrails(
      "You have $200.00 left this month. I'd buy Apple over Microsoft.",
      [20_000],
    );
    expect(kept).toEqual(["You have $200.00 left this month."]);
    expect(dropped.map((d) => d.issues)).toEqual([["investment_advice"]]);
  });

  it("leaves demo advice its picks, labelled as it is", () => {
    expect(checkGuardrails("Get into VTI now.", [], undefined, "demo_advice").ok).toBe(true);
  });

  it("stays quick on a long answer", () => {
    const long = "Get into the habit of checking Apple and go with a plan over time. ".repeat(500);
    const at = performance.now();
    checkGuardrails(long, []);
    expect(performance.now() - at).toBeLessThan(500);
  });
});
