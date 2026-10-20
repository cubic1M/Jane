import { MedicalBillError, sendMedicalItem } from "@/lib/medical-bills";
import { ChatActionError, type ActionHandler } from "./handler";

// Sending a request about a medical bill from the chat (spec step 180): only on the
// person's tap, one request each time, through the provider stand-in.
export const medicalSend: ActionHandler = {
  id: "medical.send",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.medicalItem;
    if (!target) {
      throw new ChatActionError("failed", "Something went wrong. Open your medical bills instead.");
    }
    try {
      const item = await sendMedicalItem(userId, target.id, { client, now });
      return {
        answeredWith: action.label,
        note: `Sent to ${item.bill.provider}. I'll tell you what they answer.`,
      };
    } catch (error) {
      throw error instanceof MedicalBillError
        ? new ChatActionError("failed", error.message)
        : error;
    }
  },
};
