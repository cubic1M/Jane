import { NextResponse, after } from "next/server";
import { runAgentNow } from "@/lib/agent/run";
import { track } from "@/lib/analytics";
import { ChatActionError, takeChatAction } from "@/lib/jane-agent/actions";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

// A button tapped on one of Jane's phone notifications (spec step 85). The service worker
// posts here with the session cookie; the tap goes through takeChatAction, the chat's own
// checks (the person's own message, still open, offering that button). Without a session
// it answers 401 and the service worker opens the chat instead.

const STATUS: Record<ChatActionError["code"], number> = {
  not_found: 404,
  not_offered: 400,
  not_open: 409,
  expired: 409,
  failed: 409,
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Only the app's own service worker sends JSON here; a form on another site can't.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Send JSON" }, { status: 415 });
  }
  const limited = await limitOrNull("decisions", user.id);
  if (limited) return limited;

  let body: Record<string, unknown> | null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const { messageId, actionId } = body ?? {};
  if (typeof messageId !== "string" || typeof actionId !== "string" || actionId.length > 40) {
    return NextResponse.json({ error: "Invalid button" }, { status: 400 });
  }

  try {
    const { message, agentJobIds } = await takeChatAction(user.id, messageId, actionId);
    // The agent's first step, after the response (src/lib/agent/run.ts).
    after(() => runAgentNow(agentJobIds));
    await track(user.id, "chat_notification_answered", {
      channel: "push",
      action: actionId,
      kind: message.kind,
    });
    return NextResponse.json({
      answeredWith: message.answeredWith,
      note: message.refs.note ?? null,
    });
  } catch (error) {
    if (!(error instanceof ChatActionError)) throw error;
    return NextResponse.json({ error: error.message }, { status: STATUS[error.code] });
  }
}
