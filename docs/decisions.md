# Decision questions: "should I ...?"

One router, one shape. `src/lib/jane-agent/decision.ts` (`answerDecision`) answers every
"should I buy / invest / pay off / switch ...?" question. A decision is about the person's own
money (what they owe and at what rate, whether their cash cushion is built, the goals still
short), never a lookup of the thing. The sector whose subject it is answers it; the router
gives everything else the general answer.

## How a question is routed

1. `parseIntent` reads it as `{ kind: "decision", item, label }` (`decision-intents.ts`). Core
   subjects: `crypto`, `stocks`, `invest`, `payoff_or_invest`, `home`, `car`, `other`. A sector
   adds its own by adding one line to `SECTOR_DECISIONS` in `src/config/decisions.ts`
   (`{ item: "insurance", pattern: /…/ }`). A bare "should I buy?" has `item: null` and takes
   the subject of the last decision (`withTopic`), so it is about what was just discussed.
2. `decision` is in `CHAT_RULES_ONLY_KINDS`: Claude never answers these; the rules do, the same
   every time. Claude has a `decision` tool with the same facts for questions the parser misses.
3. `answerDecision` loads the general facts (`DecisionFacts`: card debt and highest rate, cash,
   monthly spending, cushion target, goals short) and whether demo advice is on, finds the
   capability whose `decides` lists the subject and calls its `decide`.
4. `decide` returns `null` to decline, and then (like a subject nobody claims) the general
   answer is given.

## What a sector writes

In your capability's entry in `capabilities/index.ts` (your sector's own files do the work):

```ts
{
  id: "investing",
  // …bank, kinds, tools, answer as before…
  decides: ["crypto", "stocks", "invest", "payoff_or_invest"],
  decide: async ({ userId, client, now, item, label, facts, advice }) => ({
    body: "…a short answer with the person's dollars…",
    actions: [/* links, never a button that acts */],
    confidence: { percent: 85, reason: "12 months of balances" },
  }),
}
```

Rules:

- Start from `facts` (high-rate debt, then the cushion, then goals, then the thing). Figures
  are theirs; rates and thresholds live in `src/config`.
- `advice` is false on real accounts: give facts and no recommendation (`REAL_ACCOUNT_ADVICE`).
  When true, recommendations are allowed and the router adds the demo advice label.
- Never predict what the thing will do; no promised outcomes.
- The router adds `N% sure: reason.`, the decision topic (so a follow-up is bound to it) and
  the advice flag. Old buttons never answer a question: a follow-up is read against
  `refs.topic` only.
- Add must-pass questions to the bank (sector `decision` or your own) with `avoid` for the
  wrong answers you've seen.
