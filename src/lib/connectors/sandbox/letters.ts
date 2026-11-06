import type { Connector, WebhookEvent } from "../types";
import { SIMULATED, sandboxRef, text } from "./shared";

// Letters to a company (a cancellation by written notice, a stop-payment notice), shaped like
// PostGrid's print-and-mail API in test mode (roadmap round 4 mock spec): certified by default, a
// letter can be stopped until midnight Eastern, and its status arrives by webhook signed
// "PostGrid-Signature: t=<seconds>,v1=<hex>". This sandbox mails nothing and calls nobody; its
// webhook parser reads PostGrid's own payloads, so the real adapter can reuse it.

// PostGrid stops a letter only while it's "ready": until 12 AM Eastern the next day for one sent as
// soon as possible.
export function nextMidnightEastern(now: Date): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // How far Eastern is behind UTC right now, then the next local midnight in UTC.
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const nextLocalMidnight = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + 1,
  );
  return new Date(nextLocalMidnight - offset);
}

type PostGridLetter = {
  id?: unknown;
  status?: unknown;
  imbStatus?: unknown;
  trackingNumber?: unknown;
  live?: unknown;
  cancellation?: { cancelledByUser?: unknown } | null;
};

// A PostGrid letter event as Jane reads it (round 4's status table). PostGrid sends no event id, so
// the letter's id, status and tracking stand in for one.
export function parsePostGridEvent(body: unknown): WebhookEvent | null {
  const event = body as { type?: unknown; data?: PostGridLetter } | null;
  const letter = event?.data;
  if (event?.type !== "letter.updated" && event?.type !== "letter.created") return null;
  if (!letter || typeof letter.id !== "string" || typeof letter.status !== "string") return null;
  const eventId = [
    letter.id,
    letter.status,
    letter.imbStatus ?? "",
    letter.trackingNumber ?? "",
  ].join(":");
  const base = { eventId, externalRef: letter.id };
  // Returned after it was mailed, or before: either way it never arrived.
  if (letter.imbStatus === "returned_to_sender") {
    return {
      ...base,
      outcome: "undone",
      note: "The letter came back: the address didn't take it.",
    };
  }
  if (letter.status === "completed")
    return { ...base, outcome: "done", note: "The letter was mailed." };
  if (letter.status === "cancelled") {
    // Cancelled by Jane is already cancelled in Jane; anything else is PostGrid refusing it.
    return letter.cancellation?.cancelledByUser === true
      ? { ...base, outcome: "info", note: "Cancelled, as asked." }
      : { ...base, outcome: "failed", note: "The letter couldn't be printed." };
  }
  const tracking =
    typeof letter.trackingNumber === "string" ? ` Tracking: ${letter.trackingNumber}.` : "";
  return { ...base, outcome: "info", note: `On its way (${letter.status}).${tracking}` };
}

export const sandboxLetters: Connector = {
  id: "sandbox_letters",
  name: "Letters to a company (sandbox)",
  category: "subscriptions",
  capabilities: ["prefill", "act"],
  scopes: ["cancel_subscriptions", "contact_companies"],
  sandbox: true,
  movesMoney: false,
  prefill: (details) => {
    const company = text(details, "company");
    const address = text(details, "toAddress");
    const from = text(details, "fromName");
    const purpose = details.purpose === "stop_payment" ? "stop_payment" : "cancel";
    const says =
      purpose === "stop_payment"
        ? `Asks ${company} to stop taking payments from you`
        : `Asks ${company} to cancel your account and confirm it in writing`;
    return {
      kind: purpose === "stop_payment" ? "stop_payment_letter" : "cancel_by_letter",
      amountCents: 0,
      summary: `Send ${company} a certified letter`,
      steps: [
        { label: "To", value: `${company}, ${address}` },
        { label: "From", value: from },
        { label: "Says", value: says },
        { label: "Sent as", value: "Certified mail" },
        { label: "Can be stopped", value: "Until midnight Eastern, the day it's sent" },
        {
          label: "Says who it is",
          value: "Written by Jane, an AI assistant, for you, with your yes",
        },
      ],
      details: { company, toAddress: address, fromName: from, purpose, mailingClass: "certified" },
    };
  },
  act: async (draft, context) => ({
    externalRef: sandboxRef("sbx_letter", context.idempotencyKey),
    state: "pending",
    cancelUntil: nextMidnightEastern(context.now),
    note: `${SIMULATED} Letter to ${String(draft.details.company)} queued to print.`,
  }),
  cancel: async () => true,
  webhook: {
    signing: {
      kind: "hmac_sha256_tv",
      secretEnv: "SANDBOX_LETTERS_WEBHOOK_SECRET",
      header: "PostGrid-Signature",
    },
    parse: parsePostGridEvent,
  },
};
