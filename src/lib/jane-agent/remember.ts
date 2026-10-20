import type { PreferenceDraft } from "./preferences";
import { parseStyle } from "./style";
import { dateAndDays } from "./sources/source";

// Things the person tells Jane about themselves (spec step 91), understood by rules: their
// payday, something they need ("I need my car", "don't cancel Netflix") or anything after
// "remember that". Pure. Nothing is saved here: Jane offers "Remember this", and only that
// tap saves it (src/lib/jane-agent/actions/remember.ts).

const ORDINAL = "(\\d{1,2})(?:st|nd|rd|th)?";
const PAYDAY = new RegExp(
  `^(?:my )?pay ?days? (?:is|are) (?:on )?(?:the )?${ORDINAL}(?:(?: and|,| &) (?:the )?${ORDINAL})?(?: of (?:the|each|every) month)?$` +
    `|^i (?:get|am|'m) paid (?:on )?(?:the )?${ORDINAL}(?:(?: and|,| &) (?:the )?${ORDINAL})?(?: of (?:the|each|every) month)?$`,
);
const KEEP =
  /^i (?:really )?(?:need|use|love|want to keep|can'?t live without|keep using) (?:my |the |our )?(.+)$|^(?:don'?t|never|stop) (?:cancel(?:ling)?|suggest(?:ing)?(?: (?:cancell?ing|that i cancel|i cancel))?) (?:my |the |our )?(.+)$|^keep (?:my |the |our )?(.+)$/;
const REMEMBER = /^(?:please )?remember (?:that )?(.+)$/;

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const sentence = (text: string) => {
  const t = text.trim().replace(/[.!]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// What the person told Jane, as what "Remember this" would save, or null.
export function parseFact(text: string): PreferenceDraft | null {
  const inner = REMEMBER.exec(text)?.[1] ?? text;
  // Spec step 188: how they like Jane to talk.
  const style = parseStyle(inner);
  if (style) return style;
  const pay = PAYDAY.exec(inner);
  if (pay) {
    const days = [...new Set(pay.slice(1).filter(Boolean).map(Number))]
      .filter((d) => d >= 1 && d <= 31)
      .sort((a, b) => a - b);
    if (days.length > 0) {
      return {
        kind: "fact",
        key: "payday",
        value: { days },
        label:
          days.length === 1
            ? `Payday is the ${ordinal(days[0])}`
            : `Paid on the ${days.map(ordinal).join(" and the ")}`,
      };
    }
  }
  const keep = KEEP.exec(inner);
  if (keep) {
    const target = (keep[1] ?? keep[2] ?? keep[3]).trim();
    if (target && target.split(" ").length <= 4) {
      return {
        kind: "fact",
        key: `keep:${target}`,
        value: { target },
        label: `You want to keep your ${target}`,
      };
    }
  }
  const remember = REMEMBER.exec(text);
  if (remember) {
    const words = remember[1].trim();
    return {
      kind: "fact",
      key: `note:${words.slice(0, 60)}`,
      value: { text: words },
      label: sentence(words),
    };
  }
  return null;
}

// The next payday from the days the person gave, after asOf (YYYY-MM-DD).
export function nextPaydayFrom(days: readonly number[], asOf: string): string {
  const [y, m, d] = asOf.split("-").map(Number);
  for (let add = 0; add < 2; add += 1) {
    const year = y + Math.floor((m - 1 + add) / 12);
    const month = ((m - 1 + add) % 12) + 1;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (const day of days) {
      const date = Math.min(day, last);
      if (add === 0 && date <= d) continue;
      return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
    }
  }
  return asOf;
}

export const paydayLine = (days: readonly number[], asOf: string) =>
  `Your next payday is ${dateAndDays(nextPaydayFrom(days, asOf), asOf)}, as you told me.`;
