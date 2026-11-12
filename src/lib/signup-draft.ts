// What someone typed on /signup, kept for a few minutes when the form sends them back (a code
// that isn't valid, the Terms box left empty), so they fix the one thing wrong instead of typing
// their code and email again (debugger 11-12: a mistyped code cleared every field). In an
// httpOnly cookie for /signup only, never in the URL.

export const SIGNUP_DRAFT_COOKIE = "fc_signup_draft";
export const SIGNUP_DRAFT_MINUTES = 10;

export type SignupDraft = { email?: string; invite?: string };

const field = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;

export function draftFrom(form: FormData): string {
  return JSON.stringify({
    email: field(form.get("email"), 254),
    invite: field(form.get("invite"), 40),
  });
}

// The cookie's value as the form's defaults; anything odd in it is dropped.
export function readDraft(value: string | undefined): SignupDraft {
  if (!value) return {};
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    return { email: field(raw.email, 254), invite: field(raw.invite, 40) };
  } catch {
    return {};
  }
}
