import type { CheckQuestion } from "./bank";

// Investing decisions people really type (the chat, founder bug "should i buy bitcoin" got a
// crypto connect offer instead of an answer). Each must get a direct answer of three sentences
// or fewer from the rules alone, from the person's own numbers, with the demo advice label in
// advice mode (the grading profile) and facts only on real accounts. Must-pass.

const ask = (n: number, text: string, after?: string): CheckQuestion => ({
  id: `dec-${n}`,
  text,
  needs: "rules",
  ...(after ? { after } : {}),
  expect: { intent: "investments", maxChars: 520 },
  sector: "investing",
  page: "/investments",
  tool: "investing_decision",
  profile: "demo_advice",
});

export const DECISION_QUESTIONS: readonly CheckQuestion[] = [
  ask(1, "should i buy bitcoin"),
  ask(2, "should i buy ethereum"),
  ask(3, "is bitcoin a good investment"),
  ask(4, "how much crypto should i own"),
  ask(5, "should i invest in crypto"),
  ask(6, "should i buy tesla stock"),
  ask(7, "should i buy apple shares"),
  ask(8, "should i buy nvidia"),
  ask(9, "should i buy stocks"),
  ask(10, "is tesla a good buy"),
  ask(11, "index funds or picking stocks"),
  ask(12, "should i pick my own stocks"),
  ask(13, "index fund vs individual stocks"),
  ask(14, "should i invest or pay off debt"),
  ask(15, "should i pay off my credit card or invest"),
  ask(16, "invest or pay down my loans"),
  ask(17, "should i invest before paying off debt"),
  ask(18, "should i save or invest"),
  ask(19, "invest or build my emergency fund first"),
  ask(20, "is now a good time to invest"),
  ask(21, "is it a good time to buy stocks"),
  ask(22, "should i wait for a dip"),
  ask(23, "is the market too high to invest"),
  ask(24, "should i sell my stocks"),
  ask(25, "should i sell some of my investments"),
  ask(26, "should i start investing"),
  ask(27, "am i ready to invest"),
  ask(28, "how much should i invest"),
  ask(29, "when should i start investing"),
  // A follow-up after any of them.
  ask(30, "should i buy?", "dec-1"),
];
