import type { ConnectorCapability, ConnectorCategory, ConsentScope } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";

// What every connector is (docs/connectors.md). A connector is a partner Jane reads from, fills in
// steps for, or acts through. Each one says what it can do and what consent it needs; the pipeline
// (./pipeline.ts) decides whether it may, and its acting methods only work inside a grant (./gate.ts).

export type CheckContext = { userId: string; client: PrismaClient; now: Date };

// One line the person sees before saying yes: "Pay to: Con Edison", "Amount: $84.12".
export type PrefilledStep = { label: string; value: string };

// Details an adapter needs to act, stored with the action. Ids and plain values only: never a
// token, password or full account number (the vault holds secrets, ./vault.ts).
export type ActionDetails = Record<string, string | number | boolean | null>;

// What a connector proposes: the steps the person checks, and the exact amount their yes is for.
export type ActionDraft = {
  // The connector's own name for it, e.g. "pay_bill".
  kind: string;
  // What it moves or commits, in cents; 0 for a cancellation or a quote.
  amountCents: number;
  // One line, in the person's words: "Pay Con Edison $84.12 from Checking".
  summary: string;
  steps: PrefilledStep[];
  details: ActionDetails;
};

// What the pipeline hands an acting method. `secret` opens the person's stored credential for this
// connector for the length of a callback (./vault.ts); it is never given to the connector as a value
// it could keep.
export type ActContext = {
  userId: string;
  actionId: string;
  // Sent to the partner so a retry can't act twice on their side either.
  idempotencyKey: string;
  now: Date;
  withSecret: <T>(use: (secret: string) => Promise<T>) => Promise<T>;
};

export type ActResult = {
  // The partner's id for what it did, for its webhooks and a cancel.
  externalRef: string;
  // done: finished. pending: the partner will say how it went (a webhook). handed_off: the last step
  // is the person's (a guided cancel, a partner's own screen); the note says what to do.
  state: "done" | "pending" | "handed_off";
  // Until when the partner can still take it back, if it can.
  cancelUntil: Date | null;
  // What came back, in the person's words, without secrets.
  note: string;
};

// How a webhook's sender is checked (./webhooks.ts). Each provider signs its own way.
export type WebhookSigning =
  // HMAC-SHA256 of `${timestamp}.${body}` in one header, the time in another (Stripe-like).
  | { kind: "hmac_sha256"; secretEnv: string; signatureHeader: string; timestampHeader: string }
  // Svix (Resend, and others): svix-id, svix-timestamp and svix-signature, "v1,<base64>".
  | { kind: "svix"; secretEnv: string }
  // One header "t=<unix seconds>,v1=<hex>" over `${t}.${body}` (PostGrid, Stripe's Stripe-Signature;
  // several v1 while a secret rotates).
  | { kind: "hmac_sha256_tv"; secretEnv: string; header: string };

// A verified event, read by the connector: whose action it is about, and what happened.
export type WebhookEvent = {
  // The partner's event id, for replay protection.
  eventId: string;
  // The ActResult.externalRef it is about.
  externalRef: string;
  // reversed: money came back after it was done. undone: something that isn't money didn't hold
  // after it was done (a letter returned, a company saying it didn't cancel).
  outcome: "done" | "failed" | "reversed" | "undone" | "info";
  note: string;
};

export type Connector = {
  id: string;
  name: string;
  category: ConnectorCategory;
  capabilities: readonly ConnectorCapability[];
  // Every one must be in the person's consent before anything runs.
  scopes: readonly ConsentScope[];
  // The exact consent text for a scope in EXACT_TEXT_SCOPES, as the partner and counsel approved
  // it, with its version. Shown and stored word for word when the person agrees.
  consentText?: Partial<Record<ConsentScope, { version: string; text: string }>>;
  // A sandbox adapter reaches nobody: it simulates the partner. Only sample-data people get one, so
  // a real account never sees a pretend success; real connectors are the other way round.
  sandbox: boolean;
  // Whether acting moves money (a payment, a transfer). Needs REAL_MONEY_MOVEMENT to be real.
  movesMoney: boolean;
  // Set when what it prefills is a personalized investment or tax recommendation: held back from
  // real people until HUMAN_REVIEW_READY (src/config/connectors.ts).
  recommends?: "investment" | "tax";
  // What the person asked for, filled in for them to check. Pure: no call to the partner.
  prefill?: (request: ActionDetails) => ActionDraft;
  // Checks a pure prefill can't make, against the person's own data (their accounts, their
  // autopay, an open action for the same thing). `prepare` runs at plan time and returns the
  // request prefill gets, with facts from the database in place of what the caller sent. `guard`
  // runs again at the yes and just before acting. Either throws BadRequest to refuse. They read
  // through scopedFor(context.userId): never anyone else's rows.
  // actionId: the plan already made with this idempotency key, when it's asked for again.
  prepare?: (
    request: ActionDetails,
    context: CheckContext & { actionId?: string },
  ) => Promise<ActionDetails>;
  guard?: (details: ActionDetails, context: CheckContext & { actionId: string }) => Promise<void>;
  // Carries out a draft the person said yes to. Gated: only inside the pipeline's grant.
  act?: (draft: ActionDraft, context: ActContext) => Promise<ActResult>;
  // Takes it back at the partner, while ActResult.cancelUntil allows. Gated.
  cancel?: (externalRef: string, context: ActContext) => Promise<boolean>;
  webhook?: {
    signing: WebhookSigning;
    // Reads a body whose signature already checked out. Null for one the connector doesn't know.
    parse: (body: unknown) => WebhookEvent | null;
  };
};

// What prefill throws for a request it can't fill in (a missing payee, a move to the same account).
// The pipeline refuses it as "bad_request"; the message is for the team, never shown as is.
export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

// The methods the gate guards.
export const ACTING_METHODS = ["act", "cancel"] as const satisfies readonly (keyof Connector)[];
