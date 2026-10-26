import { DraftReturnError, confirmDraftReturn, dismissDraftReturn } from "@/lib/draft-return";
import { ChatActionError, type ActionHandler } from "./handler";

// The draft return from the chat (spec step 272): confirming what Jane read (then it checks
// it), or saying it isn't a draft return. Nothing is filed.

const failed = (error: unknown): never => {
  if (error instanceof DraftReturnError) throw new ChatActionError("failed", error.message);
  throw error;
};

const draftOf = (refs: { draftReturn?: string }) => {
  if (!refs.draftReturn)
    throw new ChatActionError("failed", "Something went wrong. Open Your draft return instead.");
  return refs.draftReturn;
};

export const taxDraftConfirm: ActionHandler = {
  id: "tax.draft_confirm",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const v = await confirmDraftReturn(userId, draftOf(message.refs), { client, now }).catch(
      failed,
    );
    return {
      answeredWith: action.label,
      note:
        v.findings.length === 0
          ? "Checked: nothing to fix. Filing is yours."
          : `Checked: ${v.findings.length} thing${v.findings.length === 1 ? "" : "s"} to fix before you file. I'll show each one.`,
    };
  },
};

export const taxDraftDismiss: ActionHandler = {
  id: "tax.draft_dismiss",
  on: "open",
  async run({ userId, message, action, client }) {
    await dismissDraftReturn(userId, draftOf(message.refs), { client }).catch(failed);
    return { answeredWith: action.label, note: "OK. I won't use it." };
  },
};
