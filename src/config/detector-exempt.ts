// Registry capabilities (src/lib/jane-agent/capabilities) that don't make suggestions of
// their own, and why (spec step 254). Every other capability needs a detector in
// src/detectors, and a test fails if a new one has neither. Remove an entry when a detector
// for it is added.

export const DETECTOR_EXEMPT: Readonly<Record<string, string>> = {
  goals: "shows and sets the goals the person chose; the emergency-fund detector suggests one",
  spending: "answers what was spent; the suggestions come from the detectors behind it",
  coming_up: "lists bills and dates; nothing to suggest",
  saved: "reports what Jane already saved",
  whole_picture: "summarises the other capabilities",
  what_if: "a scenario the person asks for; the strategist (step 256) uses it as a tool",
  long_view: "a projection the person asks for; the strategist uses it as a tool",
  profile: "shows and corrects what Jane knows",
  did: "reports what Jane did",
  act: "carries out a button the person tapped",
  autopilot: "settings for what Jane may do alone",
  memory: "what Jane remembers",
  life_event: "checklists the person opens; suggestions arrive through the detectors",
};
