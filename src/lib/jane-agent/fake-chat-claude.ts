import type Anthropic from "@anthropic-ai/sdk";

// A scripted stand-in for Claude in Jane's chat, for the end-to-end tests only: on when
// CHAT_FAKE_CLAUDE is "1" (playwright.config.ts sets it, nothing else does) and never on a Vercel
// production deploy. It answers only the messages scripted below, as the SDK's stream would, so
// a test can drive one real turn (guardrails, rewrite, stream, storage) without a key or a cent.
// Every other message goes the usual way (no key in e2e: the rules).

type Round = { text: string };
// The rounds of one message: the first answer, then the answer to the app's rewrite note.
const SCRIPTS: Record<string, Round[]> = {
  // e2e/chat-refusals.spec.ts: a draft the guardrails block (a promised result), then the rewrite.
  "should i pay off my card before saving?": [
    { text: "Yes. Paying off your card first will definitely save you the most." },
    {
      text: "Yes: paying off your card first could save you the most, because it charges more interest than your savings earn. I can help you plan the payments from your numbers.",
    },
  ],
};

export function fakeChatEnabled(): boolean {
  return process.env.CHAT_FAKE_CLAUDE === "1" && process.env.VERCEL_ENV !== "production";
}

// The scripted client for this message, or null when there is no script (or the fake is off).
export function fakeChatClaude(question: string): (() => Pick<Anthropic, "messages">) | null {
  if (!fakeChatEnabled()) return null;
  const rounds = SCRIPTS[question.trim().toLowerCase()];
  if (!rounds) return null;
  return () =>
    ({
      messages: {
        stream: (params: { messages: Anthropic.MessageParam[] }) => {
          // Which round: one more for each note the app has sent back ("(From the app…").
          const notes = params.messages.filter(
            (m) =>
              m.role === "user" &&
              typeof m.content === "string" &&
              m.content.startsWith("(From the app"),
          ).length;
          const { text } = rounds[Math.min(notes, rounds.length - 1)];
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          const emit = (name: string, ...args: unknown[]) =>
            (listeners[name] ?? []).forEach((fn) => fn(...args));
          const stream = {
            on(name: string, fn: (...args: unknown[]) => void) {
              (listeners[name] ??= []).push(fn);
              return stream;
            },
            abort() {},
            async finalMessage() {
              emit("streamEvent", {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              });
              for (let i = 0; i < text.length; i += 12) emit("text", text.slice(i, i + 12));
              return {
                stop_reason: "end_turn",
                content: [{ type: "text", text }],
                usage: { input_tokens: 0, output_tokens: 0 },
              };
            },
          };
          return stream;
        },
      },
    }) as never;
}
