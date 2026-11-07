import {
  APP_STORE_DESCRIPTORS,
  CANCEL_METHODS,
  NOT_GOOGLE_PLAY,
  type CancelMethod,
} from "@/config/cancel-methods";
import { composeLinks, emailSender, type ComposeLinks } from "../email/compose";
import type { PrefilledStep } from "../types";

// How a subscription gets cancelled (roadmap round 7): steps first, because only 3 of the 56 most
// common subscriptions document cancelling by email. In order:
//
// 1. App-store billing: a charge billed through Apple or Google Play can only be cancelled there,
//    whatever the merchant's own page says, so that wins.
// 2. A merchant Jane knows: its own route. Email only where the merchant documents it; a letter
//    where written notice is the documented way; a phone-only merchant gets the steps, since Jane
//    makes no calls.
// 3. Anyone else: plain guided steps.

export type CancelRoute = {
  // guided and app_store: the person follows the steps. email and letter: Jane can send it.
  channel: "app_store" | "guided" | "email" | "letter";
  billedVia: "apple" | "google" | null;
  merchant: string;
  method: CancelMethod | null;
  steps: PrefilledStep[];
  // Only for email, and only the merchant's own documented address.
  email: string | null;
  // For email: who sends it (round 19's gate), and, when it's the person, the draft ready to send
  // from their own address.
  sentBy: "jane" | "person" | null;
  compose: ComposeLinks | null;
};

// Apple's own route covers every Apple-billed subscription (support.apple.com/en-us/118428, in the
// round 7 row). Google Play's: support.google.com/googleplay/answer/7018481, added by infra.
const APP_STORE_STEPS = {
  apple: [
    "On an iPhone or iPad: Settings > your name > Subscriptions > choose it > Cancel",
    "On the web: account.apple.com > Subscriptions",
  ],
  google: [
    "In the Google Play app: your profile > Payments & subscriptions > Subscriptions > choose it > Cancel",
    "On the web: play.google.com/store/account/subscriptions",
  ],
} as const;

const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function billedVia(descriptor: string | null | undefined): "apple" | "google" | null {
  if (!descriptor) return null;
  const text = descriptor.toUpperCase();
  if (APP_STORE_DESCRIPTORS.apple.some((mark) => text.includes(mark))) return "apple";
  if (
    APP_STORE_DESCRIPTORS.google.some((mark) => text.includes(mark)) &&
    !NOT_GOOGLE_PLAY.some((mark) => text.includes(mark))
  ) {
    return "google";
  }
  return null;
}

const isWordChar = (char: string | undefined) => char !== undefined && /[a-z0-9]/.test(char);

// Whether `alias` appears in `text` as whole words: no letter or digit right before or after it.
// Plain text, not a pattern, so a dot in "max.com" is a dot.
function containsWords(text: string, alias: string): boolean {
  for (let at = text.indexOf(alias); at !== -1; at = text.indexOf(alias, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + alias.length])) return true;
  }
  return false;
}

// The known merchant whose alias appears in the merchant's name or the charge's descriptor. The
// longest alias wins, so "verizon fios" beats "verizon".
export function knownMerchant(...names: (string | null | undefined)[]): CancelMethod | null {
  const text = names
    .filter(Boolean)
    .map((n) => normalized(String(n)))
    .join(" | ");
  if (!text) return null;
  let best: { method: CancelMethod; length: number } | null = null;
  for (const method of CANCEL_METHODS) {
    for (const alias of method.aliases) {
      const found = containsWords(text, alias);
      if (found && (!best || alias.length > best.length)) best = { method, length: alias.length };
    }
  }
  return best?.method ?? null;
}

const numbered = (lines: readonly string[]): PrefilledStep[] =>
  lines.map((value, i) => ({ label: `Step ${i + 1}`, value }));

export function cancelRoute({
  merchant,
  descriptor = null,
}: {
  merchant: string;
  descriptor?: string | null;
}): CancelRoute {
  const via = billedVia(descriptor);
  const method = knownMerchant(merchant, descriptor);
  const name = method?.merchant ?? merchant;
  if (via) {
    return {
      channel: "app_store",
      billedVia: via,
      merchant: name,
      method,
      steps: numbered(APP_STORE_STEPS[via]),
      email: null,
      sentBy: null,
      compose: null,
    };
  }
  if (!method) {
    return {
      channel: "guided",
      billedVia: null,
      merchant: name,
      method: null,
      steps: numbered([
        `Sign in to your ${merchant} account and look under Account, Billing or Subscription for Cancel`,
        "Keep the confirmation email or screenshot",
      ]),
      email: null,
      sentBy: null,
      compose: null,
    };
  }
  const channel =
    method.channel === "email" && method.email
      ? "email"
      : method.channel === "letter"
        ? "letter"
        : "guided";
  const email = channel === "email" ? method.email : null;
  const sentBy = email ? emailSender({ acceptsAgentEmail: method.acceptsAgentEmail }) : null;
  return {
    channel,
    billedVia: null,
    merchant: name,
    method,
    steps: numbered(method.steps),
    email,
    sentBy,
    compose:
      email && sentBy === "person"
        ? composeLinks({
            to: email,
            subject: `Please cancel my ${name} membership`,
            body: `Hello,\n\nPlease cancel my ${name} membership on the account under this email address, and confirm by email when it's done.\n\nThank you.`,
          })
        : null,
  };
}
