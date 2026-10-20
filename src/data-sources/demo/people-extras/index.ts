import type { PersonId } from "@/config/people";
import type { PersonExtra } from "../demo-people";
import { INSURANCE_EXTRAS } from "./insurance";
import { INVESTING_EXTRAS } from "./investing";
import { LOANS_EXTRAS } from "./loans";
import { TAXES_EXTRAS } from "./taxes";

// One file per lane, merged into the sample people by ../demo-people.ts.
export const PEOPLE_EXTRAS: readonly Partial<Record<PersonId, PersonExtra>>[] = [
  LOANS_EXTRAS,
  TAXES_EXTRAS,
  INSURANCE_EXTRAS,
  INVESTING_EXTRAS,
];
