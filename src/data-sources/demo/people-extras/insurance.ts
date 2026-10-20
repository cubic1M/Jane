import type { PersonId } from "@/config/people";
import type { PersonExtra } from "../demo-people";

// What the insurance lane adds to the sample people's lives so its detectors (src/detectors) have
// signals to find. Add entries to a person's list; use keys unique to this lane (prefix them
// "insurance-"). Don't edit ../demo-people.ts. Every sample person's written lists are in
// src/config/people.ts; a detector must fire for the people it is for and for no one on a
// must-not list.
export const INSURANCE_EXTRAS: Partial<Record<PersonId, PersonExtra>> = {};
