import type { DEBT_ACTION_IDS } from "../debt-action-ids";
import { debtPlanAvalanche, debtPlanSnowball } from "./debt-plan";
import type { ActionHandler } from "./handler";

// Every button handler about loans and debt (spec Phase Y), registered in ./index.ts in one
// place.
export const DEBT_ACTION_HANDLERS: Readonly<
  Record<(typeof DEBT_ACTION_IDS)[number], ActionHandler>
> = {
  "debt_plan.avalanche": debtPlanAvalanche,
  "debt_plan.snowball": debtPlanSnowball,
};
