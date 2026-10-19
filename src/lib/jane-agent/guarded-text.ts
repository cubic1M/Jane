import { checkGuardrails, type GuardrailProfile } from "@/lib/guardrails";

// Claude's chat answer shown as it's written, without showing anything the guardrails
// haven't passed: text is held back until a sentence (or line) ends, then released only if
// everything shown so far, with it, passes. Once something fails, nothing more is shown;
// the stored answer (checked whole, src/lib/jane-agent/claude.ts) replaces the draft.

// Where the first complete sentence or line ends, or 0. A full stop inside a figure
// ("$1,200.50") isn't followed by a space, so it doesn't count.
export function sentenceEnd(text: string): number {
  const match = /[.!?:](?=\s)|\n/.exec(text);
  return match ? match.index + match[0].length : 0;
}

export class GuardedText {
  private held = "";
  private shown = "";
  private stopped = false;

  constructor(
    private readonly allowedCents: () => readonly number[],
    private readonly show: (text: string) => void,
    // Demo advice mode (spec step 98) checks with the demo profile.
    private readonly profile: GuardrailProfile = "standard",
  ) {}

  push(delta: string): void {
    this.held += delta;
    // One sentence at a time, so a bad one never holds back the good ones before it.
    for (let end = sentenceEnd(this.held); end > 0 && !this.stopped;) {
      this.release(end);
      end = this.stopped ? 0 : sentenceEnd(this.held);
    }
  }

  // The answer is complete: whatever is left, if it passes.
  finish(): void {
    this.release(this.held.length);
  }

  // The text so far was a lead-in to a lookup, not the answer: start again.
  reset(): void {
    this.held = "";
    this.shown = "";
    this.stopped = false;
  }

  private release(end: number): void {
    if (this.stopped || end === 0) return;
    const next = this.held.slice(0, end);
    if (!checkGuardrails(this.shown + next, this.allowedCents(), undefined, this.profile).ok) {
      this.stopped = true;
      return;
    }
    this.shown += next;
    this.held = this.held.slice(end);
    this.show(next);
  }
}
