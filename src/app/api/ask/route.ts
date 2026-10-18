import { NextResponse } from "next/server";
import { ASK_MAX_QUESTION } from "@/config/ask";
import { track } from "@/lib/analytics";
import { askJane, type HistoryMessage } from "@/lib/ask/answer";
import { ConversationMissingError, historyFor, saveExchange } from "@/lib/ask/conversations";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// A question for Jane. The response streams one JSON object per line: a "status" line
// each time Jane looks something up, then one "answer" line (only after the guardrails
// pass), or an "error" line.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("ask", user.id);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const conversationId = body?.conversationId ?? null;
  if (
    !question ||
    question.length > ASK_MAX_QUESTION ||
    (conversationId !== null &&
      (typeof conversationId !== "string" || !ID_PATTERN.test(conversationId)))
  ) {
    return NextResponse.json({ error: "Invalid question" }, { status: 400 });
  }

  let history: HistoryMessage[] = [];
  if (conversationId) {
    try {
      history = await historyFor(user.id, conversationId);
    } catch (error) {
      if (error instanceof ConversationMissingError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        const result = await askJane(user.id, history, question, {
          onStatus: (text) => send({ type: "status", text }),
        });
        const id = await saveExchange(user.id, conversationId, question, result);
        await track(user.id, "ask_answered", { kind: result.kind });
        send({
          type: "answer",
          conversationId: id,
          text: result.text,
          blocked: result.kind === "blocked",
        });
      } catch (error) {
        console.error("Ask Jane failed", { error: String(error) });
        send({ type: "error", text: "Something went wrong. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
