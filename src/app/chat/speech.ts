// Talking to Jane (spec step 186), the parts that aren't the browser: what the browser's
// speech recognition heard, and a message as words to read aloud. Speech becomes text in
// the browser; only the text the person sends ever reaches Jane, through the same rules and
// guardrails as typing. Nothing here records or stores sound. Pure.

// What SpeechRecognition's results say so far: every phrase in order, and whether the last
// one is final.
export type HeardResults = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;

export function transcriptOf(results: HeardResults): { text: string; final: boolean } {
  const phrases = Array.from(results);
  const text = phrases
    .map((r) => r[0]?.transcript ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, final: phrases.length > 0 && phrases[phrases.length - 1].isFinal };
}

// A message as it should sound: list marks dropped, each line a sentence.
export function spokenText(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .join("\n")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-•>]|\d+\.)\s+/, "").trim())
    .filter(Boolean)
    .map((line) => (/[.!?:]$/.test(line) ? line : `${line}.`))
    .join(" ");
}

// What to tell the person when listening stops with an error (SpeechRecognitionErrorEvent).
export function heardError(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed")
    return "The microphone is off for this site. Turn it on in your browser, or type instead.";
  if (code === "no-speech") return "I didn't hear anything. Try again, or type instead.";
  if (code === "aborted") return "Stopped listening.";
  return "Speaking didn't work this time. Type instead.";
}
