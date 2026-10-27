import { MonthCloseError, confirmClose } from "@/lib/month-close";

import { answeredElsewhere, type ActionHandler } from "./handler";
import { monthLabel } from "@/lib/day-label";

// "Looks right" on the monthly close (spec step 244): the charges Jane asked about stay as they
// are and the month closes.
export const closeConfirm: ActionHandler = {
  id: "close.confirm",
  on: "open",
  async run(context) {
    const month = context.message.refs.closeMonth ?? "";
    try {
      await confirmClose(context.userId, month, { client: context.client, now: context.now });
    } catch (error) {
      if (error instanceof MonthCloseError) throw answeredElsewhere(error.message);
      throw error;
    }
    return {
      answeredWith: context.action.label,
      note: `Thanks. ${monthLabel(month, { long: true })} is closed; its figures stay as they are unless you correct something.`,
    };
  },
};
