import { createHash } from "node:crypto";

// A sign-in link signs in whichever browser opens it, so a link someone else asked for would put
// you in their account, and what you upload after that would be theirs to read. So a link only
// signs in once this browser has said yes on /login/continue, which names the account. A cookie
// from that page is the yes: another site can't set it, and the link alone doesn't carry it. It
// also keeps mail scanners, which open every link, from using the link up.

export const LINK_CONFIRM_COOKIE = "fc_link_confirm";
export const LINK_CONFIRM_MINUTES = 5;
const CALLBACK_PATH = "/api/auth/callback/resend";

// For this token and this address together: a yes to a page naming your own address can't be spent
// on the same token with someone else's.
export const linkConfirmValue = (token: string, email: string) =>
  createHash("sha256")
    .update(JSON.stringify(["sign-in-link", token, email]))
    .digest("hex");

type LinkRequest = {
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
  cookies: { get(name: string): { value: string } | undefined };
};

// Where a sign-in link should go first, or null if this isn't one or this browser has said yes.
export function linkNeedsConfirming(request: LinkRequest): string | null {
  if (request.pathname !== CALLBACK_PATH) return null;
  const tokens = request.searchParams.getAll("token");
  const emails = request.searchParams.getAll("email");
  // Auth.js reads the last of a repeated field, so a first one here could be a different value.
  if (tokens.length > 1 || emails.length > 1) return "/login";
  // Auth.js answers a link with no token with its own error.
  if (!tokens[0]) return null;
  const yes = linkConfirmValue(tokens[0], emails[0] ?? "");
  if (request.cookies.get(LINK_CONFIRM_COOKIE)?.value === yes) return null;
  return `/login/continue${request.search}`;
}

export const signInLinkTarget = (fields: { token: string; email: string; callbackUrl?: string }) =>
  `${CALLBACK_PATH}?${new URLSearchParams({
    ...(fields.callbackUrl ? { callbackUrl: fields.callbackUrl } : {}),
    token: fields.token,
    email: fields.email,
  })}`;
