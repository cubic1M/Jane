// Messages for the ?error= codes Auth.js (and our sign-in actions) send to /login.
const MESSAGES: Record<string, string> = {
  InvalidEmail: "Enter a valid email address.",
  Verification: "That sign-in link has expired or was already used. Request a new one below.",
  OAuthAccountNotLinked:
    "That email already has an account with a different sign-in method. Use the one you signed up with.",
  AccessDenied: "Sign-in was cancelled or not allowed.",
};

const FALLBACK = "Something went wrong signing you in. Please try again.";

export function authErrorMessage(code: string | string[] | undefined): string | null {
  if (!code) return null;
  const first = Array.isArray(code) ? code[0] : code;
  return MESSAGES[first] ?? FALLBACK;
}
