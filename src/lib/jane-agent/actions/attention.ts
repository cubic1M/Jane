import { AttentionError, resumeKind } from "../attention-load";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// "Keep them coming" (spec step 147): a kind Jane stopped bringing up comes back, counted
// afresh from now.
export const attentionResume: ActionHandler = {
  id: "attention.resume",
  on: "open",
  async run(context) {
    const { userId, client, now, message } = context;
    const source = message.refs.attentionSource;
    if (!source)
      throw new ChatActionError("failed", "Something went wrong. Open Settings instead.");
    try {
      const label = await resumeKind(userId, source, { client, now });
      return {
        answeredWith: context.action.label,
        note: `OK, I'll keep bringing up ${label}.`,
      };
    } catch (error) {
      if (error instanceof AttentionError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};
