import { NOTICE_KINDS, NOTICE_REMIND_DAYS } from "@/config/tax-notices";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { NoticeView } from "@/lib/tax-notices";
import { centsOf, type Check } from "@/planning/tax-notice";
import type { MessageAction, MessageRefs } from "./types";

// Letters from the IRS and the state in the chat (spec step 217): a notice Jane read, to
// confirm; then what it says, what it found against the person's records, and the
// response to draft; then the draft, to send (the team or the person). Never paid or sent
// without a tap.

export const LETTERS_HREF = "/taxes/letters";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function noticeReadingMessage(n: NoticeView): Message {
  const f = n.fields;
  const complete = Boolean(f.kind && f.noticeDate);
  return {
    body: complete
      ? `I read your tax notice from ${n.fileName}: ${NOTICE_KINDS[n.kind].title}${f.taxYear ? ` for ${f.taxYear}` : ""}${n.dueOn ? `, due by ${dayLabel(n.dueOn, { year: true })}` : ""}. Is that right? I'll put the date on your deadlines when you confirm.`
      : `I couldn't read all of ${n.fileName}. Fill in the rest and confirm, and I'll put its date on your deadlines.`,
    refs: { taxNotice: n.id },
    actions: [
      ...(complete
        ? [
            {
              id: "tax.notice_confirm",
              label: "Yes, that's right",
              kind: "primary",
            } as MessageAction,
          ]
        : []),
      {
        id: "open",
        label: complete ? "Fix a field" : "Fill it in",
        kind: "link",
        href: LETTERS_HREF,
      },
      { id: "tax.notice_no", label: "Not a tax notice", kind: "secondary" },
    ],
  };
}

const RESPONSE_ID = {
  agree: "tax.notice_agree",
  pay: "tax.notice_pay",
  dispute: "tax.notice_dispute",
} as const;
const RESPONSE_LABEL = {
  agree: "Draft: I agree",
  pay: "Draft: I'm paying",
  dispute: "Draft: I disagree",
} as const;

export function noticeOpenMessage(
  n: NoticeView,
  check: Check & { advice: boolean },
  today: string,
): Message {
  const rule = NOTICE_KINDS[n.kind];
  const amount = centsOf(n.fields, "amount");
  const days = n.dueOn ? Math.round((Date.parse(n.dueOn) - Date.parse(today)) / 86_400_000) : null;
  const when = n.dueOn
    ? days !== null && days < 0
      ? ` It was due ${dayLabel(n.dueOn, { year: true })}, so deal with it now.`
      : ` It's due by ${dayLabel(n.dueOn, { year: true })}${days !== null ? ` (${days} ${days === 1 ? "day" : "days"})` : ""}.`
    : "";
  const what = `${rule.title}${amount > 0 ? `: ${formatCents(amount)} ${rule.amount === "owed" ? "owed" : "proposed"}` : ""}.`;
  const found = check.lines.length > 0 ? ` ${check.lines.join(" ")}` : "";
  const points = check.advice && check.points ? ` ${check.why}` : "";
  return {
    body: `${what}${when} ${rule.what}${found}${points} Nothing is paid or sent until you tap.`,
    refs: { taxNotice: n.id, ...(check.advice && check.points ? { advice: true as const } : {}) },
    actions: [
      ...[...rule.responses]
        .sort((a, b) => Number(b === check.points) - Number(a === check.points))
        .map(
          (r, i) =>
            ({
              id: RESPONSE_ID[r],
              label: RESPONSE_LABEL[r],
              kind: i === 0 ? "primary" : "secondary",
            }) as MessageAction,
        ),
      { id: "open", label: "See the notice", kind: "link", href: LETTERS_HREF },
    ],
  };
}

export function noticeDraftMessage(n: NoticeView): Message {
  return {
    body: `Here's the draft reply to your ${n.kind === "OTHER" ? "notice" : n.kind}. Add your details where it's in [brackets]:\n\n${n.draft}\n\nHave Jane's team send it, or send it yourself?`,
    refs: { taxNotice: n.id },
    actions: [
      { id: "tax.notice_team", label: "Have Jane's team send it", kind: "primary" },
      { id: "tax.notice_mine", label: "I'll send it myself", kind: "secondary" },
      { id: "open", label: "See the notice", kind: "link", href: LETTERS_HREF },
    ],
  };
}

// The days before it's due Jane says it again.
export const remindDays = (n: NoticeView, today: string): number | null => {
  if (!n.dueOn || n.handledBy) return null;
  const left = Math.round((Date.parse(n.dueOn) - Date.parse(today)) / 86_400_000);
  return NOTICE_REMIND_DAYS.filter((d) => left <= d).at(-1) ?? null;
};

export function noticesReply(notices: NoticeView[]): Message {
  const active = notices.filter((n) => n.status === "confirmed");
  if (active.length === 0) {
    return {
      body: "Photograph or upload a letter from the IRS or your state (Documents, kind \"Tax notice\"). I'll read it, explain it, put its date on your deadlines, check it against your records and draft a reply. A notice isn't always right, and it isn't always wrong.",
      refs: {},
      actions: [{ id: "open", label: "My letters", kind: "link", href: LETTERS_HREF }],
    };
  }
  const lines = active.map(
    (n) =>
      `- ${NOTICE_KINDS[n.kind].title}${n.dueOn ? `, due ${dayLabel(n.dueOn, { year: true })}` : ""}: ${n.handledBy ? "reply sent on your say" : n.draft ? "reply drafted" : "needs your reply"}`,
  );
  return {
    body: `You have ${active.length} tax ${active.length === 1 ? "notice" : "notices"} on file.\n${lines.join("\n")}`,
    refs: {},
    actions: [{ id: "open", label: "My letters", kind: "link", href: LETTERS_HREF }],
  };
}
