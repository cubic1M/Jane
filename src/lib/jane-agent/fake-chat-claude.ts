import type Anthropic from "@anthropic-ai/sdk";

// A scripted stand-in for Claude in Jane's chat, for the end-to-end tests only: on when
// CHAT_FAKE_CLAUDE is "1" (playwright.config.ts sets it, nothing else does) and never on a Vercel
// production deploy. It answers only the messages scripted below, as the SDK's stream would, so
// a test can drive one real turn (guardrails, rewrite, stream, storage) without a key or a cent.
// Every other message goes the usual way (no key in e2e: the rules).

type Round = { text: string };
// A message that is answered with a lookup: the first round asks for the tool, the next writes what
// `say` makes of its result, so a test drives the real tool and the real guardrails.
type Lookup = {
  tool: string;
  input: Record<string, unknown>;
  say: (result: {
    matched?: number;
    dataStarts?: string | null;
    transactions?: { date: string; amount: string }[];
  }) => string;
};
// The rounds of one message: the first answer, then the answer to the app's rewrite note, which
// goes on after what the person has already read (./claude.ts continueAfter).
const LOOKUPS: Record<string, Lookup> = {
  // e2e/chat-lookup.spec.ts: the founder's own question (11-28).
  "did i buy something from california arts before": {
    tool: "search_transactions",
    input: { merchant: "california arts" },
    say: (r) =>
      r.matched
        ? `Yes. You bought from California Arts ${r.matched} time${r.matched === 1 ? "" : "s"}: ${(r.transactions ?? []).map((t) => `${t.amount} on ${t.date}`).join(", ")}.`
        : `No. I don't see a purchase from California Arts in the data I have, which starts ${r.dataStarts}.`,
  },
};

const SCRIPTS: Record<string, Round[]> = {
  // e2e/chat-refusals.spec.ts: a draft the guardrails block (a promised result), then the rewrite.
  "should i pay off my card before saving?": [
    { text: "Yes. Paying off your card first will definitely save you the most." },
    {
      text: "Paying off your card first could save you the most, because it charges more interest than your savings earn. I can help you plan the payments from your numbers.",
    },
  ],
};

function fakeChatEnabled(): boolean {
  return process.env.CHAT_FAKE_CLAUDE === "1" && process.env.VERCEL_ENV !== "production";
}

// The scripted client for this message, or null when there is no script (or the fake is off).
export function fakeChatClaude(question: string): (() => Pick<Anthropic, "messages">) | null {
  if (!fakeChatEnabled()) return null;
  const lookup = LOOKUPS[question.trim().toLowerCase()];
  if (lookup) return () => lookupClient(lookup);
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

function lookupClient({ tool, input, say }: Lookup) {
  return {
    messages: {
      stream: (params: { messages: Anthropic.MessageParam[] }) => {
        const last = params.messages.at(-1)?.content;
        const results = Array.isArray(last)
          ? last.flatMap((b) => (b.type === "tool_result" ? [String(b.content)] : []))
          : [];
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
        const stream = {
          on(name: string, fn: (...args: unknown[]) => void) {
            (listeners[name] ??= []).push(fn);
            return stream;
          },
          abort() {},
          async finalMessage() {
            const usage = { input_tokens: 0, output_tokens: 0 };
            if (results.length === 0) {
              return {
                stop_reason: "tool_use",
                content: [{ type: "tool_use", id: "toolu_fake", name: tool, input }],
                usage,
              };
            }
            const text = say(JSON.parse(results[0]));
            (listeners.streamEvent ?? []).forEach((fn) =>
              fn({
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              }),
            );
            for (let i = 0; i < text.length; i += 12) {
              (listeners.text ?? []).forEach((fn) => fn(text.slice(i, i + 12)));
            }
            return { stop_reason: "end_turn", content: [{ type: "text", text }], usage };
          },
        };
        return stream;
      },
    },
  } as never;
}
