import {
  NoticeError,
  chooseResponse,
  confirmTaxNotice,
  dismissTaxNotice,
  sendResponse,
  type Response,
} from "@/lib/tax-notices";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// Tax notices from the chat (spec step 217): confirm a reading, pick a response (it drafts
// one), then hand it to the team or send it oneself. Each is the person's tap; nothing is
// paid or sent by Jane.

const failed = (error: unknown): never => {
  if (error instanceof NoticeError) throw new ChatActionError("failed", error.message);
  throw error;
};
const idOf = ({ message }: ActionContext) => {
  const id = message.refs.taxNotice;
  if (!id) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
  return id;
};

export const taxNoticeConfirm: ActionHandler = {
  id: "tax.notice_confirm",
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    const n = await confirmTaxNotice(userId, idOf(context), { client, now }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Confirmed${n.dueOn ? `: it's on your deadlines for ${n.dueOn}` : ""}. Tell me what you want to do about it.`,
    };
  },
};

export const taxNoticeNo: ActionHandler = {
  id: "tax.notice_no",
  on: "open",
  async run(context) {
    await dismissTaxNotice(context.userId, idOf(context), { client: context.client }).catch(failed);
    return { answeredWith: context.action.label, note: "OK. I won't use it." };
  },
};

const respond = (
  id: "tax.notice_agree" | "tax.notice_pay" | "tax.notice_dispute",
  response: Response,
): ActionHandler => ({
  id,
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    await chooseResponse(userId, idOf(context), response, { client, now }).catch(failed);
    return {
      answeredWith: action.label,
      note: "Here's a draft. It's on the Letters page; nothing is sent until you choose who sends it.",
    };
  },
});
export const taxNoticeAgree = respond("tax.notice_agree", "agree");
export const taxNoticePay = respond("tax.notice_pay", "pay");
export const taxNoticeDispute = respond("tax.notice_dispute", "dispute");

const send = (id: "tax.notice_team" | "tax.notice_mine", by: "team" | "you"): ActionHandler => ({
  id,
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    await sendResponse(userId, idOf(context), by, { client, now }).catch(failed);
    return {
      answeredWith: action.label,
      note:
        by === "team"
          ? "Done: Jane's team has it and will send it."
          : "OK: it's yours to send. Keep a copy.",
    };
  },
});
export const taxNoticeTeam = send("tax.notice_team", "team");
export const taxNoticeMine = send("tax.notice_mine", "you");
