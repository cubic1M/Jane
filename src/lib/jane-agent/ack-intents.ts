// Short replies that are not questions (QA sweep): "yes", "no thanks", "remind me tomorrow",
// "why?" and "tell me more", and "how much should I have in an emergency fund". Answered by the
// rules at once, never sent to Claude: Jane acts only on a tap, so a typed "yes" points at the
// button, and "why?" is read against what was just discussed. Pure.

export type AckIntent = { kind: "ack"; yes: boolean } | { kind: "remind" };

const YES =
  /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|sounds good|yes please)\W*$/;
const NO = /^(?:no|nope|nah|no thanks|no thank you|not now|not really|never ?mind|skip it)\W*$/;
const REMIND =
  /^(?:remind me|ask me|bring it up|show me)(?: again)?(?: later| tomorrow| next week)\W*$/;

export function parseAck(text: string): AckIntent | null {
  if (YES.test(text)) return { kind: "ack", yes: true };
  if (NO.test(text)) return { kind: "ack", yes: false };
  if (REMIND.test(text)) return { kind: "remind" };
  return null;
}

// "Why?", "tell me more", "explain": about whatever the last answer was about.
export const EXPLAIN =
  /^(?:why|why is that|why is that first|why that one|how come|tell me more|more|more detail|more details|explain|explain that|elaborate|go on)\W*$/;

// "How much should I have in an emergency fund": their cushion, from their numbers.
export const CUSHION_ASK =
  /\bhow much (?:should i|do i need to|ought i to) (?:have|keep|save|hold)(?: saved)?(?: in| for)? (?:an? |my )?(?:emergency|rainy day)(?: fund| savings| money)?\b/;
