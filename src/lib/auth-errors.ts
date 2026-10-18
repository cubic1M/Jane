// Messages for the ?error= codes Auth.js (and our sign-in actions) send to /login.
const MESSAGES: Record<string, string> = {
  InvalidEmail: "Enter a valid email address.",
  Verification: "That sign-in link has expired or was already used. Request a new one below.",
  OAuthAccountNotLinked:
    "That email already has an account with a different sign-in method. Use the one you signed up with.",
  AccessDenied: "Sign-in was cancelled or not allowed.",
  ConsentRequired: "Please agree to the Terms and Privacy Policy to sign up.",
  InviteRequired: "The beta is invite-only. Enter your invite code to sign up.",
  InvalidInvite: "That invite code isn't valid. Check it and try again.",
  InviteUsedUp: "That invite code has been used up. Ask for a new one.",
  InviteExpired: "That invite code has expired. Ask for a new one.",
  TooManyRequests: "Too many sign-in attempts. Wait a few minutes and try again.",
};

const FALLBACK = "Something went wrong signing you in. Please try again.";

export function authErrorMessage(code: string | string[] | undefined): string | null {
  if (!code) return null;
  const first = Array.isArray(code) ? code[0] : code;
  return MESSAGES[first] ?? FALLBACK;
}
