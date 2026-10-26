import { STYLE_LIST_LINES_SHORT } from "@/config/agent-chat";
import type { Preference, PreferenceDraft } from "./preferences";
import type { Reply } from "./replies";

// Jane's way of talking (spec step 188): how long its answers are, whether the numbers come
// first, and how often it posts. Picked up from what the person says ("keep it short") and
// saved only on their tap (step 91), or set in Settings. The rules' answers and Claude's
// instructions follow it; the answer shape (step 89: the answer first, with their figure)
// holds at every length. Pure.

export type Length = "short" | "normal" | "detailed";
export type Voice = "plain" | "numbers";
export type Style = { length: Length; voice: Voice };

export function styleOf(prefs: readonly Preference[]): Style {
  const find = (key: string) => prefs.find((p) => p.kind === "style" && p.key === key)?.value;
  const length = find("length")?.length;
  const voice = find("voice")?.voice;
  return {
    length: length === "short" || length === "detailed" ? length : "normal",
    voice: voice === "numbers" ? "numbers" : "plain",
  };
}

export const LENGTH_LABELS: Record<Length, string> = {
  short: "Keep answers short",
  normal: "Answers as they come",
  detailed: "Give me the detail",
};
export const VOICE_LABELS: Record<Voice, string> = {
  plain: "Plain words first",
  numbers: "Numbers first",
};

export const lengthDraft = (length: Length): PreferenceDraft => ({
  kind: "style",
  key: "length",
  value: { length },
  label: LENGTH_LABELS[length],
});
export const voiceDraft = (voice: Voice): PreferenceDraft => ({
  kind: "style",
  key: "voice",
  value: { voice },
  label: VOICE_LABELS[voice],
});

const SHORT =
  /^(?:keep it|be|make it|answer)(?: more)? (?:short|brief|shorter|briefer|concise)(?: please)?$|^(?:shorter|briefer) (?:answers|replies)(?: please)?$|^(?:just )?(?:the )?(?:short|brief) (?:version|answers?)$|^less (?:detail|text|words)$/;
const DETAILED =
  /^(?:be|give me|make it|go) (?:more )?(?:detailed|in depth|thorough)$|^(?:more|give me the) detail(?:s)?$|^longer answers$|^explain (?:more|everything|in detail)$|^tell me more every ?time$/;
const NORMAL =
  /^(?:normal|usual) (?:length|answers)$|^(?:go )?back to (?:normal|the usual) (?:length|answers)$/;
const NUMBERS =
  /^(?:numbers first|lead with (?:the )?numbers|give me the numbers first|figures first)$/;
const PLAIN = /^(?:plain words|words first|plain|no jargon|simple words)(?: first)?$/;
const AS_THEY_COME =
  /^(?:tell|message|ping) me (?:things )?as they (?:come|happen)(?: up)?$|^(?:stop|no more) (?:the )?(?:morning )?(?:summary|agenda|brief)$/;
const DAILY =
  /^(?:one|a) (?:message|summary) (?:a day|each morning|every morning)$|^(?:just|only) (?:the )?morning (?:summary|agenda|brief)$|^(?:use|bring back) the (?:morning )?(?:agenda|brief)$/;

// What the person said about how Jane talks, as what "Remember this" would save, or null.
export function parseStyle(text: string): PreferenceDraft | null {
  const t = text.replace(/[.!]+$/, "").trim();
  if (SHORT.test(t)) return lengthDraft("short");
  if (DETAILED.test(t)) return lengthDraft("detailed");
  if (NORMAL.test(t)) return lengthDraft("normal");
  if (NUMBERS.test(t)) return voiceDraft("numbers");
  if (PLAIN.test(t)) return voiceDraft("plain");
  if (AS_THEY_COME.test(t))
    return {
      kind: "style",
      key: "posting",
      value: { posting: "as_they_come" },
      label: "Tell me things as they come, not in one morning message",
    };
  if (DAILY.test(t))
    return {
      kind: "style",
      key: "posting",
      value: { posting: "daily" },
      label: "One message each morning, then only what's urgent",
    };
  return null;
}

const FIGURE = /\$[\d,]+(?:\.\d\d)?/;
const isListLine = (line: string) => /^\s*(?:-|\d+\.)\s/.test(line);

// The rules' answer in the person's style. Short keeps the first sentence (the answer, with
// their figure) and a few list lines; numbers-first brings the lines with figures up front.
// Buttons and refs are never touched, so every answer still carries its one clear thing.
export function shapeReply(reply: Reply, style: Style): Reply {
  if (style.length !== "short" && style.voice === "plain") return reply;
  let lines = reply.body.split("\n");
  if (style.voice === "numbers") {
    const [first, ...rest] = lines;
    const plain = rest.filter((l) => !isListLine(l));
    const listed = rest.filter(isListLine);
    const withFigure = plain.filter((l) => FIGURE.test(l));
    const without = plain.filter((l) => !FIGURE.test(l));
    // The first line stays first when it already has a figure.
    lines =
      FIGURE.test(first) || withFigure.length === 0
        ? [first, ...withFigure, ...without, ...listed]
        : [withFigure[0], first, ...withFigure.slice(1), ...without, ...listed];
  }
  if (style.length === "short") {
    const [first, ...rest] = lines;
    const sentences = first.split(/(?<=[.!?])\s+/);
    const head = sentences[0];
    const list = rest.filter(isListLine).slice(0, STYLE_LIST_LINES_SHORT);
    lines = [first.length > head.length && !isListLine(first) ? head : first, ...list];
  }
  return { ...reply, body: lines.join("\n") };
}

// A line for Claude's instructions, or null at the defaults.
export function styleInstructions(style: Style): string | null {
  const parts: string[] = [];
  if (style.length === "short")
    parts.push(
      "Answer in one or two short sentences: the answer with their figure, then the one suggestion. No lists unless they ask.",
    );
  if (style.length === "detailed")
    parts.push(
      "Give a fuller answer: the answer first, then the reasons with their figures and what you'd do. Still no filler.",
    );
  if (style.voice === "numbers")
    parts.push(
      "Lead with the figures: put their numbers in the first sentence, words around them.",
    );
  return parts.length === 0
    ? null
    : `The person likes answers this way (always keep the answer first, with their figure, and use only figures from their numbers): ${parts.join(" ")}`;
}
