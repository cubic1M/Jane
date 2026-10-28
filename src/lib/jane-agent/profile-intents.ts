// "What do you know about me" (spec step 253), typed. Pure.

export type ProfileIntent = { kind: "profile" };

// Also "who am I", "a summary of who I am" and "tell me about myself" (founder, 2026-10-26).
const PROFILE =
  /\bwhat (?:do|does) (?:you|jane) (?:really )?(?:know|think you know) about me\b|\bwhat have you learned about me\b|\b(?:show|see|open) (?:me )?(?:my|the) profile\b|\bthe picture of me\b|\bwhat you know about me\b|\bwho am i\s*[?!.]*\s*$|\b(?:summary|picture|overview|description) of (?:who i am|me|myself)\b|\b(?:summari[sz]e|describe) (?:me|who i am|myself)\b|\btell me about (?:me|myself)\b|\bwho (?:do you think|you think) i am\b|\bwhat (?:kind|sort) of person am i\b/;

export function parseProfile(text: string): ProfileIntent | null {
  return PROFILE.test(text) ? { kind: "profile" } : null;
}
