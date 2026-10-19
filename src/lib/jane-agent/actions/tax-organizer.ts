import { TAX_TAGS, UNTAGGED, isTaxTagKind } from "@/config/tax";
import { TaxOrganizerError, markTaxForm, setTaxTag } from "@/lib/tax-organizer";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// Tax tags and forms from the chat (spec step 119), through the organizer's own code
// (src/lib/tax-organizer.ts): keep or drop a tag Jane wasn't sure about (for every charge
// from that merchant), a tag the person asked for by typing, and "I have it" on a form.

const wrong = () =>
  new ChatActionError("failed", "Something went wrong. Open your tax tags instead.");

async function tagMerchant({ userId, message, client }: ActionContext, keep: boolean) {
  const { merchantKey, taxTag } = message.refs;
  if (!merchantKey || !taxTag) throw wrong();
  const tag = keep && taxTag !== UNTAGGED ? taxTag : null;
  if (tag !== null && !isTaxTagKind(tag)) throw wrong();
  try {
    const { count } = await setTaxTag(userId, { merchantKey }, tag, { client, via: "chat" });
    return { tag, count };
  } catch (error) {
    if (error instanceof TaxOrganizerError) throw new ChatActionError("failed", error.message);
    throw error;
  }
}

const charges = (n: number) => `${n} ${n === 1 ? "charge" : "charges"}`;

export const taxTagYes: ActionHandler = {
  id: "tax.tag_yes",
  on: "open",
  async run(context) {
    const { count } = await tagMerchant(context, true);
    return {
      answeredWith: context.action.label,
      note: `Kept. I'll tag ${charges(count)} from there the same way, and any new ones.`,
    };
  },
};

export const taxTagNo: ActionHandler = {
  id: "tax.tag_no",
  on: "open",
  async run(context) {
    await tagMerchant(context, false);
    return {
      answeredWith: context.action.label,
      note: "OK, untagged. I'll leave charges from there out of your taxes.",
    };
  },
};

// "Yes, tag them" on a typed request ("tag Staples as work").
export const taxTagSet: ActionHandler = {
  id: "tax.tag_set",
  on: "open",
  async run(context) {
    const { tag, count } = await tagMerchant(context, true);
    return {
      answeredWith: context.action.label,
      note: tag
        ? `Done: ${charges(count)} tagged ${TAX_TAGS[tag].label.toLowerCase()}, and new ones will be too.`
        : `Done: ${charges(count)} untagged.`,
    };
  },
};

export const taxFormGot: ActionHandler = {
  id: "tax.form_got",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { taxForm, taxYear } = message.refs;
    if (!taxForm || typeof taxYear !== "number") throw wrong();
    try {
      const form = await markTaxForm(userId, taxYear, taxForm, true, { client, now, via: "chat" });
      return {
        answeredWith: action.label,
        note: `Ticked off: ${form.form} from ${form.from}. Keep it with your tax papers.`,
      };
    } catch (error) {
      if (error instanceof TaxOrganizerError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
};
