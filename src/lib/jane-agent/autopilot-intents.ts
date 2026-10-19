import { SECTORS, SECTOR_WORDS, type Sector, type SectorLevel } from "@/config/autopilot-sectors";
import { parseAmount } from "./intents";

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
  const level: SectorLevel | null = ASK.test(text)
    ? "ask"
    : SAFE.test(text)
      ? "safe"
      : ALL.test(text)
        ? "all"
        : null;
  if (!level) return null;
  const amount = level === "ask" ? null : parseAmount(text);
  const each = amount !== null && EACH.test(text);
  return {
    kind: "autopilot_sector",
    sector,
    level,
    actionCapCents: each ? amount : null,
    monthlyCapCents: amount !== null && !each ? amount : null,
  };
}
