import { AuditRecordsError, remindRetention } from "@/lib/audit-records";
import { ChatActionError, type ActionHandler } from "./handler";

// "Remind me" before a year's tax records can be thrown away (spec step 171). Jane never
// deletes anything: the reminder is on the person's deadlines.
export const taxRecordsRemind: ActionHandler = {
  id: "tax.records_remind",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const year = message.refs.taxYear;
    if (typeof year !== "number") {
      throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    }
    try {
      const r = await remindRetention(userId, year, { client, now, via: "chat" });
      return {
        answeredWith: action.label,
        note: `Done: a reminder about your ${r.year} records is on your deadlines. I won't delete anything.`,
      };
    } catch (error) {
      if (error instanceof AuditRecordsError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
};
