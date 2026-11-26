import { SECTORS, SECTOR_WORDS, type Sector, type SectorLevel } from "@/config/autopilot-sectors";
import { parseAmount } from "./amount";

// One autopilot, every sector (spec step 141), typed: "let Jane handle insurance up to $50
// a month", "always ask me about taxes", "what can you do by yourself?". Pure.

export type SectorIntent =
  | {
      kind: "autopilot_sector";
      sector: Sector;
      level: SectorLevel;
      actionCapCents: number | null;
      monthlyCapCents: number | null;
    }
  | { kind: "autopilot_overview" };

const OVERVIEW =
  /\bwhat (?:can|do|will) you do (?:by|on) your ?(?:own|self)\b|\bhow much (?:can|do) you do (?:by|on) your ?(?:own|self)\b|\b(?:my|the) autopilot (?:settings|levels?|caps?)\b|\bwhat'?s my autopilot\b/;
const ALL =
  /\b(?:let|allow) (?:jane|you)\b.*\b(?:handle|do|pay|switch|move|take care of|manage)\b|\b(?:jane|you) (?:can|may) (?:handle|pay|switch|move|take care of|manage)\b|\bby (?:her|your)self\b/;
const SAFE = /\b(?:only )?the safe (?:stuff|things|ones)\b/;
const ASK =
  /\balways ask\b|\bask (?:me )?(?:first )?(?:before|about)\b|\bstop (?:handling|doing|paying|switching|moving)\b/;
// "don't let Jane handle insurance" asks it to stop, never to take over.
const NEGATED =
  /\b(?:don'?t|do not|never|no longer|not)\b(?!\s+(?:more|over|above|exceed\w*|greater|higher|beyond)\b)[^.?!;]*\b(?:let|allow)\b|\b(?:don'?t|do not) want (?:jane|you) to\b/;
// "don't pay my bills by yourself": a refusal beside an autonomy phrase is a stop, whatever else
// the sentence grants (the stricter reading wins).
// "not more than $200" is a limit, not a refusal.
const NEGATED_AUTONOMY =
  /\b(?:don'?t|do not|never|no longer|not|stop(?!\s+(?:asking|checking|bugging|nagging)\b))\b(?!\s+(?:more|over|above|exceed\w*|greater|higher|beyond)\b)[^.?!;]*\b(?:by (?:her|your)self|on (?:her|your) own|automatically|without (?:asking|checking|me))\b/;
const MONTHLY = /\b(?:a|per|each|every) month\b|\bmonthly\b/;
const EACH = /\b(?:each|per|a) (?:time|payment|switch|transfer|bill)\b|\bat a time\b/;

function sectorIn(text: string): Sector | null {
  return (
    SECTORS.find((s) =>
      SECTOR_WORDS[s].some((w) => new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`).test(text)),
    ) ?? null
  );
}

export function parseSectorIntent(text: string): SectorIntent | null {
  if (OVERVIEW.test(text)) return { kind: "autopilot_overview" };
  const sector = sectorIn(text);
  if (!sector) return null;
  const level: SectorLevel | null =
    ASK.test(text) || NEGATED.test(text) || NEGATED_AUTONOMY.test(text)
      ? "ask"
      : SAFE.test(text)
        ? "safe"
        : ALL.test(text)
          ? "all"
          : null;
  if (!level) return null;
  if (level === "ask") {
    return { kind: "autopilot_sector", sector, level, actionCapCents: null, monthlyCapCents: null };
  }
  // Each cap gets its own period: "up to $200 per payment and $500 a month" is two caps.
  let actionCapCents: number | null = null;
  let monthlyCapCents: number | null = null;
  // A comma inside an amount ("$1,200") is not a break between clauses.
  for (const part of text.split(
    /\band\b|(?<!\d),|,(?!\d{3}(?!\d))|;|\bbut\b|\bwith\b(?!\s+(?:each|every|a|per)\b)/,
  )) {
    const amount = parseAmount(part);
    if (amount === null) continue;
    // The period belongs to the amount: what follows it. "monthly bills up to $200 per payment" is
    // a cap per payment; the "monthly" before the amount describes the bills.
    const after = part.slice(Math.max(0, part.search(/\d/)));
    if ((EACH.test(after) || EACH.test(part)) && !MONTHLY.test(after)) actionCapCents ??= amount;
    else monthlyCapCents ??= amount;
  }
  return { kind: "autopilot_sector", sector, level, actionCapCents, monthlyCapCents };
}
