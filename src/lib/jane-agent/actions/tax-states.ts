import { loadTaxProfile } from "@/lib/tax-profile";
import { ResidencyError, saveLocality, saveMoves, saveWorkState } from "@/lib/tax-states";
import { stateName } from "@/planning/tax-profile";
import { LOCAL_TAXES } from "@/config/tax-states";
import { moveLine } from "../tax-states-message";
import type { ActionId } from "../types";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// Where the person lived and worked, from the chat (spec step 165), through
// src/lib/tax-states.ts: "Yes, I moved" saves the move (spotted or typed) and makes the new
// state the profile's; "No, same state" stops Jane asking this year; the employer's state;
// and the city income tax they live under, or neither.

const failed = (error: unknown): never => {
  if (error instanceof ResidencyError) throw new ChatActionError("failed", error.message);
  throw error;
};
const broken = () =>
  new ChatActionError("failed", "Something went wrong. Open your tax profile instead.");

const saveMove = async ({ userId, message, action, client, now }: ActionContext) => {
  const move = message.refs.taxMove;
  if (!move) throw broken();
  const year = Number(move.date.slice(0, 4));
  await saveMoves(userId, year, [move], { client, now, via: "chat" }).catch(failed);
  return {
    answeredWith: action.label,
    note: `Got it: you moved ${moveLine(move)}. Your ${year} state taxes are split between ${stateName(move.from)} and ${stateName(move.to)}, and ${stateName(move.to)} is on your tax profile.`,
  };
};

export const taxMoveYes: ActionHandler = { id: "tax.move_yes", on: "open", run: saveMove };
export const taxMoveSet: ActionHandler = { id: "tax.move_set", on: "open", run: saveMove };

export const taxMoveNo: ActionHandler = {
  id: "tax.move_no",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const year = message.refs.taxYear ?? now.getUTCFullYear();
    await saveMoves(userId, year, [], { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `OK: one state all of ${year}. I won't ask again this year.`,
    };
  },
};

export const taxWorkSet: ActionHandler = {
  id: "tax.work_set",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const work = message.refs.taxWorkState;
    if (!work) throw broken();
    await saveWorkState(userId, work, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Got it: your employer is in ${stateName(work)}. Your state estimate counts it.`,
    };
  },
};

const local = (id: ActionId, index: number | null): ActionHandler => ({
  id,
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = index === null ? "none" : message.refs.taxLocals?.[index];
    if (!key) throw broken();
    const state = (await loadTaxProfile(userId, { client, now })).state.value;
    await saveLocality(userId, key, { client, now, via: "chat", state }).catch(failed);
    return {
      answeredWith: action.label,
      note:
        key === "none"
          ? "OK: no city income tax."
          : `Got it: ${LOCAL_TAXES[key].label}'s income tax is in your estimate now.`,
    };
  },
});

export const taxLocal1 = local("tax.local_1", 0);
export const taxLocal2 = local("tax.local_2", 1);
export const taxLocalNo = local("tax.local_no", null);
