"use server";

import { after } from "next/server";
import { runAgentNow } from "@/lib/agent/run";
import { ChatActionError } from "@/lib/jane-agent/actions";
import { redeemReplyLink, ReplyLinkError } from "@/lib/jane-agent/reply-links";
import { getCurrentUser } from "@/lib/session";

// The confirm button on a one-tap link from Jane's email (spec step 85). The token in the
// form is the credential, so no sign-in is needed; when someone is signed in, the link has
// to be theirs. The answer goes through takeChatAction, the chat's own checks.

export type ReplyState = { ok: boolean; message: string } | null;

export async function confirmReply(_previous: ReplyState, formData: FormData): Promise<ReplyState> {
  const signedIn = await getCurrentUser();
  try {
    const { message, agentJobIds } = await redeemReplyLink(String(formData.get("token") ?? ""), {
      signedInAs: signedIn?.id ?? null,
    });
    after(() => runAgentNow(agentJobIds));
    return {
      ok: true,
      message: message.refs.note ?? `Done: ${message.answeredWith ?? "answered"}.`,
    };
  } catch (error) {
    if (error instanceof ReplyLinkError || error instanceof ChatActionError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
