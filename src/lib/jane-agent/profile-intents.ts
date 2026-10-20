// "What do you know about me" (spec step 253), typed. Pure.

export type ProfileIntent = { kind: "profile" };

const PROFILE =
  /\bwhat (?:do|does) (?:you|jane) (?:really )?(?:know|think you know) about me\b|\bwhat have you learned about me\b|\b(?:show|see|open) (?:me )?(?:my|the) profile\b|\bthe picture of me\b|\bwhat you know about me\b/;

export function parseProfile(text: string): ProfileIntent | null {
  return PROFILE.test(text) ? { kind: "profile" } : null;
}
