import { SIGNWELL } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { holderName } from "@/lib/holder-name";
import { todayOf } from "@/lib/today";
import { knownMerchant } from "../cancel/route";
import { SIMULATED, sandboxRef } from "../sandbox/shared";
import { BadRequest, type ActionDetails, type Connector, type WebhookEvent } from "../types";
import { signwellHttp, type SignwellApi } from "./api";
import {
  PERMISSION_ACTS,
  PERMISSION_DEFAULT_MONTHS,
  PERMISSION_MAX_MONTHS,
  letterHtml,
  type PermissionAct,
} from "./letter";

// SignWell (read connectors, 11-18; developers.signwell.com, read 2026-11-17): a letter the person
// signs that lets Jane act for them with one company, with SignWell's audit trail, as the record
// behind an act (a cancellation, a request for a lower rate). After the person's yes, Jane sends it
// to them to sign; nothing else happens until they sign. It never moves money.
//
// Who signs and with which company comes from Jane's own records, never the request: the person's
// own name and email on their profile, a company Jane knows (src/config/cancel-methods.ts), one of
// a fixed list of tasks (./letter.ts), and a year unless they pick less, never past three.
//
// Two registrations. The real one reaches nobody until REAL_CONNECTORS.signwell_permission, which
// needs counsel's read of the letter and whether companies accept it (connectors-final-B), and a
// change first: SignWell's event hash covers only the event's type and time, not which document, so
// a "completed" webhook must be confirmed with Get Document before Jane relies on it (api.get). The
// sandbox twin sends nothing, for sample data.

const DAY_MS = 86_400_000;

async function signer(userId: string, client: PrismaClient) {
  const me = await scopedFor(userId, client).me.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const name = holderName(me?.name);
  if (!name) throw new BadRequest("needs the person's name on their profile");
  if (!me?.email) throw new BadRequest("needs the person's email");
  return { name, email: me.email };
}

const company = (details: ActionDetails) => {
  const known = knownMerchant(typeof details.company === "string" ? details.company : "");
  if (!known) throw new BadRequest("not a company Jane knows");
  return known.merchant;
};

const actsOf = (details: ActionDetails): PermissionAct[] => {
  const raw = typeof details.acts === "string" ? details.acts.split(",") : [];
  const acts = [...new Set(raw.map((a) => a.trim()))];
  if (acts.length === 0 || !acts.every((a) => Object.hasOwn(PERMISSION_ACTS, a))) {
    throw new BadRequest("not something a letter can let Jane do");
  }
  return acts as PermissionAct[];
};

// The last day it holds: the months the person picked (a year if none), from their own day.
async function untilOf(details: ActionDetails, userId: string, client: PrismaClient, now: Date) {
  const months = typeof details.months === "number" ? details.months : PERMISSION_DEFAULT_MONTHS;
  if (!Number.isInteger(months) || months < 1 || months > PERMISSION_MAX_MONTHS) {
    throw new BadRequest("a letter lasts 1 to 36 months");
  }
  const today = await todayOf(userId, { client, now });
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end.toISOString().slice(0, 10);
}

const permissionBase = {
  category: "permission" as const,
  capabilities: ["prefill", "act"] as const,
  scopes: ["sign_letters"] as const,
  movesMoney: false,
  prepare: async (
    request: ActionDetails,
    { userId, client, now }: { userId: string; client: PrismaClient; now: Date },
  ) => {
    const who = await signer(userId, client);
    return {
      company: company(request),
      acts: actsOf(request).join(","),
      until: await untilOf(request, userId, client, now),
      signerName: who.name,
      signerEmail: who.email,
    };
  },
  // Again at the yes and before it's sent: still a known company, still their own name and email.
  guard: async (
    details: ActionDetails,
    { userId, client }: { userId: string; client: PrismaClient },
  ) => {
    if (details.company !== company(details)) throw new BadRequest("not a company Jane knows");
    actsOf(details);
    const who = await signer(userId, client);
    if (details.signerName !== who.name || details.signerEmail !== who.email) {
      throw new BadRequest("not the person's own name and email");
    }
  },
  prefill: (details: ActionDetails) => {
    const to = String(details.company ?? "");
    const acts = actsOf(details);
    const until = String(details.until ?? "");
    if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new BadRequest("company and until");
    return {
      kind: "permission_letter",
      amountCents: 0,
      summary: `Send you a letter to sign that lets Jane act for you with ${to}`,
      steps: [
        { label: "Lets Jane", value: acts.map((a) => PERMISSION_ACTS[a]).join("; ") },
        { label: "With", value: to },
        { label: "Until", value: until },
        { label: "Signed by", value: String(details.signerName ?? "") },
        { label: "Sent to you to sign at", value: String(details.signerEmail ?? "") },
        { label: "Jane may not", value: "move your money or change who owns the account" },
      ],
      details,
    };
  },
};

// SignWell's webhook body (Event Data): { event: { type, time, hash }, data: { object: the
// document } }. Completed is signed; declined, expired or cancelled ends it; anything else is news.
export function parseSignwellEvent(body: unknown): WebhookEvent | null {
  const event = (body ?? {}) as {
    event?: { type?: unknown; time?: unknown };
    data?: { object?: { id?: unknown } };
  };
  const type = event.event?.type;
  const id = event.data?.object?.id;
  if (typeof type !== "string" || typeof id !== "string") return null;
  const outcome =
    type === "document_completed"
      ? "done"
      : type === "document_declined" || type === "document_expired" || type === "document_canceled"
        ? "failed"
        : "info";
  const note =
    outcome === "done"
      ? "You signed the letter."
      : outcome === "failed"
        ? "The letter wasn't signed, so Jane won't act on it."
        : "Waiting for your signature.";
  return {
    eventId: `${type}:${String(event.event?.time ?? "")}:${id}`,
    externalRef: id,
    outcome,
    note,
  };
}

export function signwellConnector(api: SignwellApi = signwellHttp()): Connector {
  return {
    ...permissionBase,
    id: "signwell_permission",
    name: "Letters you sign to let Jane act for you, through SignWell",
    capabilities: [...permissionBase.capabilities],
    scopes: [...permissionBase.scopes],
    sandbox: false,
    act: async (draft, context) => {
      const letter = {
        signerName: String(draft.details.signerName),
        company: String(draft.details.company),
        acts: actsOf(draft.details),
        until: String(draft.details.until),
      };
      const expiresIn = SIGNWELL.expiresInDays;
      const sent = await api.send({
        name: `Permission for Jane: ${letter.company}`,
        subject: `Your letter to let Jane act for you with ${letter.company}`,
        html: letterHtml(letter),
        signer: { name: letter.signerName, email: String(draft.details.signerEmail) },
        expiresIn,
        actionId: context.actionId,
      });
      return {
        externalRef: sent.id,
        state: "pending",
        // Until it's signed, the request can be withdrawn.
        cancelUntil: new Date(context.now.getTime() + expiresIn * DAY_MS),
        note: "Sent to you to sign. It comes from SignWell by email.",
      };
    },
    cancel: async (externalRef) => api.remove(externalRef),
    webhook: {
      signing: { kind: "signwell_event_hash", secretEnv: SIGNWELL.webhookIdEnv },
      parse: parseSignwellEvent,
    },
  };
}

export const signwellPermission = signwellConnector();

export const sandboxSignwellPermission: Connector = {
  ...permissionBase,
  id: "sandbox_signwell_permission",
  name: "Letters you sign to let Jane act for you, through SignWell (sandbox)",
  capabilities: [...permissionBase.capabilities],
  scopes: [...permissionBase.scopes],
  sandbox: true,
  act: async (draft, context) => ({
    externalRef: sandboxRef("sbx_letter", context.idempotencyKey),
    state: "done",
    cancelUntil: null,
    note: `${SIMULATED} A letter for you to sign, letting Jane act for you with ${String(draft.details.company)}.`,
  }),
};
