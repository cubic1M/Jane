import { IP_PIN, SIGNS } from "@/config/tax-identity";
import type { IdentityView } from "@/lib/tax-identity";
import type { MessageAction, MessageRefs } from "./types";

// A protected tax identity in the chat (spec step 218): the January IP PIN reminder, a sign
// of theft Jane noticed, and a case's next step with the rest of the list.

export const IDENTITY_HREF = "/taxes/identity";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function ipPinMessage(view: IdentityView, setByJane: boolean): Message {
  const guide = `Get an Identity Protection PIN from the IRS: a six-digit number only you have, so no one else can file a return with your Social Security number. ${IP_PIN.who} Get a new one each January.`;
  if (setByJane) {
    return {
      body: `${guide} I've put it on your deadlines for the end of January.`,
      refs: { taxYear: view.year },
      actions: [
        { id: "open", label: "Get my IP PIN", kind: "link", href: IP_PIN.url },
        { id: "tax.ippin_have", label: "I have it", kind: "secondary" },
      ],
    };
  }
  return {
    body: `${guide} Want it on your deadlines?`,
    refs: { taxYear: view.year },
    actions: [
      { id: "tax.ippin_remind", label: "Remind me", kind: "primary" },
      { id: "tax.ippin_have", label: "I have it", kind: "secondary" },
      { id: "open", label: "Get my IP PIN", kind: "link", href: IP_PIN.url },
    ],
  };
}

export function signMessage(c: IdentityView["candidates"][number]): Message {
  const sign = SIGNS[c.sign];
  return {
    body: `${c.detail} ${sign.what} Was this because someone else used your Social Security number? If so I'll give you the steps in order and keep track of each.`,
    refs: {
      identitySign: c.sign,
      identitySource: c.key.startsWith("rejected") ? "rejected" : "notice",
    },
    actions: [
      { id: "tax.identity_open", label: "Yes, give me the steps", kind: "primary" },
      { id: "tax.identity_not", label: "No, that's not it", kind: "secondary" },
    ],
  };
}

export function caseMessage(view: IdentityView): Message | null {
  const c = view.case;
  if (!c || !c.next) return null;
  const next = c.steps.find((s) => s.key === c.next)!;
  const left = c.steps.filter((s) => !s.doneOn);
  const where = next.phone ? ` Call ${next.phone}.` : "";
  return {
    body: `Next step for your tax identity (${c.steps.length - left.length} of ${c.steps.length} done): ${next.title}. ${next.how}${where}${
      left.length > 1
        ? ` After that: ${left
            .slice(1)
            .map((s) => s.title.toLowerCase())
            .join(", then ")}.`
        : ""
    }`,
    refs: { identityStep: next.key },
    actions: [
      { id: "tax.identity_step", label: "I've done it", kind: "primary" },
      ...(next.url
        ? [{ id: "open", label: "Open the guide", kind: "link", href: next.url } as MessageAction]
        : []),
      { id: "open", label: "See all the steps", kind: "link", href: IDENTITY_HREF },
    ],
  };
}

export function identityReply(view: IdentityView, sign: string | null): Message {
  const c = caseMessage(view);
  if (c) return c;
  if (sign && Object.hasOwn(SIGNS, sign)) {
    const s = SIGNS[sign as keyof typeof SIGNS];
    return {
      body: `${s.title}: ${s.what} If that's what happened, I'll give you the steps in order (report it to the FTC, file Form 14039, freeze your credit, call the IRS) and keep track of each.`,
      refs: { identitySign: sign, identitySource: "told" },
      actions: [
        { id: "tax.identity_open", label: "Yes, that's happened", kind: "primary" },
        { id: "open", label: "See the steps", kind: "link", href: IDENTITY_HREF },
      ],
    };
  }
  return {
    body: view.havePin
      ? `You have your IP PIN for ${view.year}. If a return is rejected because one was already filed, or you get a W-2 or 1099 from a payer you don't know, or an IRS letter about a return you didn't file, tell me and I'll give you the steps.`
      : `The best protection is an IRS Identity Protection PIN: a six-digit number only you have, so no one else can file with your Social Security number. ${IP_PIN.who} If a return is rejected because one was already filed, or you get a W-2 or 1099 from a payer you don't know, or an IRS letter about a return you didn't file, tell me and I'll give you the steps.`,
    refs: {},
    actions: [
      { id: "open", label: "Get my IP PIN", kind: "link", href: IP_PIN.url },
      { id: "open", label: "My tax identity", kind: "link", href: IDENTITY_HREF },
    ],
  };
}
