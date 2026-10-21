import { KNOWN_COMPANIES } from "./investing-decisions";

// "Should I ...?" questions (src/lib/jane-agent/decision.ts) belong to the sector whose subject
// they are. The core router reads the question, works out the subject, and hands it to the
// capability whose `decides` lists it (src/lib/jane-agent/capabilities/shared.ts, Capability.
// decide). Subjects no sector claims get the general answer (card debt, cushion, goals).
//
// Core subjects: crypto, stocks, invest, payoff_or_invest (investing's), home, car, other.
// A sector adds a subject of its own by adding a line to SECTOR_DECISIONS: its subject id and
// the wording that means it (matched on the lower-cased question once it has been read as
// "should I ..."). One line per subject, in your own sector's block, nothing else to touch in
// the router. docs/decisions.md has the whole shape.

export const SECTOR_DECISIONS: readonly { item: string; pattern: RegExp }[] = [
  // investing: a company named without the word "stock" is still a stock.
  {
    item: "stocks",
    pattern: new RegExp(
      `\\b(?:buy|get|invest in|own|buy into)\\s+(?:some\\s+)?(?:${Object.keys(KNOWN_COMPANIES).join("|")})\\b(?!\\s+(?:stocks?|shares?))`,
    ),
  },
  // insurance: { item: "insurance", pattern: /\b(?:life|renters|umbrella|disability) insurance\b/ },
  // loans: { item: "loan", pattern: /\b(?:refinanc\w*|consolidat\w*)\b/ },
  // taxes: { item: "tax", pattern: /\b(?:roth|hsa|itemiz\w*|standard deduction)\b/ },
];
