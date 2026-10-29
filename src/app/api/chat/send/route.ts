import { NextResponse } from "next/server";
import { TERMS_VERSION } from "@/config/legal";
import { currentChatStart } from "@/lib/chat-start";
import { ChatInputError, sendToJane } from "@/lib/jane-agent/typing";
import { getCurrentUser } from "@/lib/session";

// Typing to Jane with the answer shown as it's written: the chat's message box posts here
// (the form's server action, src/app/chat/send.ts, is the fallback without JavaScript).
// The response streams one JSON object per line: "status" (what Jane is looking up),
// "text" (the next part of the answer, already past the guardrails), "reset" (start the
// answer again), then "done", or "error". The chat then reloads with both messages as
// stored. The text is the person's own data: it's never logged.

// A free question can take a few rounds of lookups.
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.termsVersion !== TERMS_VERSION) {
    return NextResponse.json({ error: "Accept the Terms first" }, { status: 403 });
  }
  // Only the chat's own script sends JSON here; a form on another site can't.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Send JSON" }, { status: 415 });
  }
  let body: Record<string, unknown> | null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (typeof body?.message !== "string") {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  }
  const text = body.message;
  // Read before the stream starts: the request's cookies aren't there once the response is.
  const since = await currentChatStart();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        await sendToJane(user.id, text, { onEvent: send, since });
        send({ type: "done" });
      } catch (error) {
        if (error instanceof ChatInputError) {
          send({ type: "error", text: error.message });
        } else {
          console.error("Typing to Jane failed", {
            error: error instanceof Error ? error.name : "unknown",
          });
          send({ type: "error", text: "Something went wrong. Try again." });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
