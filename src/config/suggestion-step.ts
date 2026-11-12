// The link a Yes on one of Jane's suggestions comes back with: the step Jane prepared
// (src/lib/jane-agent/actions/suggestion.ts). The cards open it right after the Yes
// (src/app/chat/suggestion-cards.tsx), so find → prefill → yes ends on the step.
export const STEP_LINK_LABEL = "Open it";
// A practice idea's Yes: where its trades or settings are.
export const PRACTICE_STEP_LABEL = "See it";
export const STEP_LINK_LABELS: readonly string[] = [STEP_LINK_LABEL, PRACTICE_STEP_LABEL];
