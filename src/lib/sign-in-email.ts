import { createHash } from "node:crypto";
import { sendMagicLink } from "@/lib/email";
import { MagicLinkSendError } from "@/lib/magic-link-error";
import { hit } from "@/lib/rate-limit";

// Sending a sign-in link, for every way of asking: the sign-in form and Auth.js's own route
// (/api/auth/signin/resend), which a script can post to directly.

// The address Auth.js will really send to: "a@b.com,1" and full-width letters reach the same
// inbox, so they must count against the same limit (a local build sent four links this way).
export function addressKey(email: string): string {
  const [local, domain = ""] = email.normalize("NFKC").toLowerCase().trim().split("@");
  return `${local}@${domain.split(",")[0]}`;
}

// A hash, so the counter never holds the address.
const subjectFor = (address: string) =>
  createHash("sha256")
    .update(`signin:${addressKey(address)}`)
    .digest("hex")
    .slice(0, 32);

export async function sendSignInEmail({ to, url }: { to: string; url: string }): Promise<void> {
  const subject = subjectFor(to);
  const [recent, today] = [await hit("signInEmail", subject), await hit("signInEmailDay", subject)];
  // Nothing goes out, and nothing says so: the person who asked sees the usual "check your email",
  // so this can't tell anyone whether the address has an account.
  if (!recent.ok || !today.ok) return;
  await sendMagicLink({ to, url }).catch(() => {
    // Already logged, with the reason. Nothing of the failure goes further: it can name the
    // address.
    throw new MagicLinkSendError();
  });
}
