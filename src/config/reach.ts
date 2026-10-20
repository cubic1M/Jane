// The reach scoreboard (spec step 258): proof that the features reach people, and that
// "85% sure" means about 85% right.

// Confidence is compared with how often suggestions proved right in bands this wide
// (percentage points), once a band has this many answered suggestions.
export const CALIBRATION_BAND = 10;
export const CALIBRATION_MIN_SAMPLE = 10;
// A detector is listed for correction when its answered suggestions were right this many
// points more or less often than it said (needs CALIBRATION_MIN_SAMPLE answers).
export const CALIBRATION_TOLERANCE = 15;

// Capabilities that no sample person's life reaches, and why. The test in
// src/detectors/reach.test.ts fails for any other capability that reaches nobody.
export const UNREACHABLE: Readonly<Record<string, string>> = {
  strategist: "ideas come from Claude each week and need a key; the sample people run without one",
};
