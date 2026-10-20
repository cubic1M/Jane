// Registry capabilities that still have no detector (spec step 254), a ratchet: the list
// only shrinks. src/detectors/detectors.test.ts fails for a capability that has no detector
// and is not here (or in src/config/detector-exempt.ts, for those that never suggest), and
// for one that is here and now has a detector (remove it). A new capability is never added
// to this list: it arrives with its detector. Phase AS lanes remove their entries as they
// add detectors.

export const MISSING_DETECTOR: readonly string[] = [];
