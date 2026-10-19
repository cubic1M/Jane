import { TaxDocumentError, chaseMissing, decideDocument, tickCollected } from "@/lib/tax-documents";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// Collected tax forms from the chat (spec step 166), through src/lib/tax-documents.ts: a
// flagged form is used only on "It's right, use it"; "Remind me to ask them" and "Remind
// me" (a missing form) put asking the payer on the deadlines; "Tick them off" ticks the
// collected forms that check out.

const failed = (error: unknown): never => {
  if (error instanceof TaxDocumentError) throw new ChatActionError("failed", error.message);
  throw error;
};
const formOf = ({ message }: ActionContext) => {
  const { taxForm, taxYear } = message.refs;
  if (!taxForm || typeof taxYear !== "number") {
    throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
  }
  return { key: taxForm, year: taxYear };
};

export const taxDocRight: ActionHandler = {
  id: "tax.doc_right",
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    const { key, year } = formOf(context);
    const form = await decideDocument(userId, year, key, "right", {
      client,
      now,
      via: "chat",
    }).catch(failed);
    return {
      answeredWith: action.label,
      note: `OK: I'm using your ${form.form} from ${form.from} as it is, and it's ticked off.`,
    };
  },
};

export const taxDocAsk: ActionHandler = {
  id: "tax.doc_ask",
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    const { key, year } = formOf(context);
    const form = await decideDocument(userId, year, key, "ask", {
      client,
      now,
      via: "chat",
    }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: asking ${form.from} for a corrected form is on your deadlines. I won't use this one meanwhile.`,
    };
  },
};

export const taxDocChase: ActionHandler = {
  id: "tax.doc_chase",
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    const { key, year } = formOf(context);
    const form = await chaseMissing(userId, year, key, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: asking ${form.from} for your ${form.form} is on your deadlines. I'll keep looking for it too.`,
    };
  },
};

export const taxDocsTick: ActionHandler = {
  id: "tax.docs_tick",
  on: "open",
  async run({ userId, message, client, now, action }) {
    const year = message.refs.taxYear;
    if (typeof year !== "number") {
      throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    }
    const n = await tickCollected(userId, year, { client, now, via: "chat" });
    return {
      answeredWith: action.label,
      note:
        n === 0 ? "They're already ticked off." : `Ticked off ${n} ${n === 1 ? "form" : "forms"}.`,
    };
  },
};
