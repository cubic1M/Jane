import { createHash } from "node:crypto";
import { sendMagicLink } from "@/lib/email";
import { MagicLinkSendError } from "@/lib/magic-link-error";
import { recordOpsEvent } from "@/lib/ops-alerts";
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

// Whether this address may get another link. Past the day's limit one still goes out an hour, never
// none: anyone can ask for a link for anyone, so a hard stop would let them lock a person out, and a
// link that went out in the last hour still works for the person it reached.
async function mayEmail(subject: string): Promise<boolean> {
  if (!(await hit("signInEmail", subject)).ok) return false;
  if ((await hit("signInEmailDay", subject)).ok) return true;
  return (await hit("signInEmailPastDay", subject)).ok;
}

export async function sendSignInEmail({ to, url }: { to: string; url: string }): Promise<void> {
  // Nothing goes out, and nothing says so: the person who asked sees the usual "check your email",
  // so this can't tell anyone whether the address has an account.
  if (!(await mayEmail(subjectFor(to)))) return;
  await sendMagicLink({ to, url }).catch(async (error: unknown) => {
    // Already logged, with the reason. Nothing of the failure goes further: it can name the
    // address. The founders hear at once (people can't get in), with only a code for why.
    await recordOpsEvent("sign_in_email_failed", { code: emailFailureCode(error) });
    throw new MagicLinkSendError();
  });
}

// Why an email didn't go, as a code with no address in it: Resend's HTTP status, the emergency
// stop, missing settings or a timeout.
export function emailFailureCode(error: unknown): string {
  const words = error instanceof Error ? error.message : "";
  const status = /Resend rejected the email \((\d{3})\)/.exec(words)?.[1];
  if (status) return `RESEND_${status}`;
  if (words.includes("KILL_EMAIL")) return "EMAIL_PAUSED";
  if (words.includes("must be set")) return "EMAIL_NOT_CONFIGURED";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return "EMAIL_TIMEOUT";
  return "EMAIL_FAILED";
}
