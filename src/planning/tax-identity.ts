import { IP_PIN, SIGNS, STEPS, type SignKey, type StepKey } from "@/config/tax-identity";

// A protected tax identity (spec step 218). Pure.
// - Every January: the IP PIN reminder, until the filing deadline.
// - A sign of theft opens a case with its steps in order; each is tracked to done.

export const inIpPinSeason = (today: string) =>
  today.slice(5) >= IP_PIN.from && today.slice(5) <= IP_PIN.until;

export const isSign = (v: unknown): v is SignKey =>
  typeof v === "string" && Object.hasOwn(SIGNS, v);
export const isStep = (v: unknown): v is StepKey => STEPS.some((s) => s.key === v);

// The steps for a sign, in order.
export const stepsFor = (sign: SignKey) => STEPS.filter((s) => !s.signs || s.signs.includes(sign));

export type CaseState = {
  sign: SignKey;
  openedOn: string;
  // Step key -> the day it was done.
  done: Partial<Record<StepKey, string>>;
};

export type CaseView = {
  sign: SignKey;
  openedOn: string;
  steps: {
    key: StepKey;
    title: string;
    how: string;
    url?: string;
    phone?: string;
    doneOn: string | null;
  }[];
  // The first step not done yet.
  next: StepKey | null;
  complete: boolean;
};

export function caseView(c: CaseState): CaseView {
  const steps = stepsFor(c.sign).map((s) => ({
    key: s.key,
    title: s.title,
    how: s.how,
    url: s.url,
    phone: s.phone,
    doneOn: c.done[s.key] ?? null,
  }));
  const next = steps.find((s) => !s.doneOn)?.key ?? null;
  return { sign: c.sign, openedOn: c.openedOn, steps, next, complete: next === null };
}

// Whether a notice reads as a sign: an identity-verification letter, or one whose reason
// talks about a return or employer the person doesn't recognize.
const SIGN_WORDS =
  /\b(?:verify your identity|identity theft|didn't file|did not file|never filed|don't recognize|do not recognize|identity verification|5071C|4883C|6331C)\b/i;
export const noticeLooksLikeTheft = (kind: string, reason: string | undefined) =>
  kind === "ID_VERIFY" || (reason !== undefined && SIGN_WORDS.test(reason));
