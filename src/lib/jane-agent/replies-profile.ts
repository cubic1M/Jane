import { sayFact } from "@/lib/profile";
import { type Profile } from "@/profile/build";
import type { Reply } from "./replies";

// What Jane knows about the person (spec step 253), in a few lines: the facts she's most
// sure of, how many are guesses, and the page where any of them can be corrected.
const SHOWN = 8;

export function profileReply(profile: Profile): Reply {
  const known = Object.values(profile.facts).filter((f) => f.value !== null && f.value !== false);
  const sure = [...known].sort((a, b) => b.confidence - a.confidence).slice(0, SHOWN);
  const guesses = known.filter((f) => f.source === "guessed").length;
  const told = known.filter((f) => f.source === "told").length;
  const lines = sure.map(
    (f) => `${f.label}: ${sayFact(f.key, f.value)} (${f.confidence}% sure, ${f.evidence})`,
  );
  const body =
    known.length === 0
      ? "I don't know much about you yet. Once your accounts are linked I'll learn from what I see, and you can always tell me more."
      : `Here's some of what I know about you: ${lines.join("; ")}. ${guesses} of what I know is my guess and ${told} you told me. If any of it is wrong, correct it on the page and every part of Jane will use the right answer.`;
  return {
    body,
    actions: [{ id: "open", label: "What Jane knows about you", kind: "link", href: "/profile" }],
    refs: {},
  };
}
