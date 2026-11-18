import { GMAIL_APP_VERIFIED, GMAIL_LIMITS } from "./gmail";

// What a person is told before they connect a Gmail mailbox: shown on /settings/mailboxes right
// above the Connect link, word for word. The mailbox row keeps the version they agreed to and when
// (gmail_mailboxes.disclosure_version), so a changed word needs a new version:
// ./gmail-disclosure.test.ts fails until it has one. Words only: nothing here decides what is read.

// A new date each time the words below change.
export const GMAIL_DISCLOSURE_VERSION = "2026-11-18";

export function gmailDisclosure(): readonly string[] {
  return [
    "You sign in on Google's own page. Jane never sees your Google password.",
    'Google will ask to let Jane "view your email messages and settings". That covers the whole mailbox. Jane can only read: it can\'t send, delete or change anything.',
    "Jane looks at who sent each email, its subject and its first line or two. It reads the whole email only when it comes from a company or other organization, not a personal address like gmail.com or icloud.com, and looks like it's about money. That check is rough, so some emails that aren't about money are read too, and Jane keeps nothing from them. Emails that look like sign-in codes or password resets are skipped.",
    "Claude, the AI from Anthropic, reads each email that passes that check and picks out what kind it is, the amount and the date. Jane saves those, with the address the email came from and when it arrived. It saves no text from the email.",
    "Jane lists what it finds on this page: bills, receipts, renewals, price changes and refunds. Nothing else in Jane uses it yet.",
    `Jane starts with your newest emails from the last ${GMAIL_LIMITS.lookBackDays} days, ${GMAIL_LIMITS.lookBackMessages} at most, then reads new email until you disconnect.`,
    "Disconnect any time. Jane deletes what it read from that mailbox and asks Google to end its permission.",
    "Only connect a mailbox that's yours, and not one from work or school.",
    // Only while it's true: Google's page stops warning once Google has checked the app.
    ...(GMAIL_APP_VERIFIED
      ? []
      : [
          "Google hasn't checked Jane yet, so its page shows a warning first. That's expected during the beta.",
        ]),
  ];
}

// The one sentence between those and the Connect link.
export const GMAIL_CONSENT =
  "By connecting, you agree to Jane reading this mailbox as described above.";
