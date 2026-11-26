import { StudentProfileError, markStudentStep } from "@/lib/student-loans";
import { stepMessage } from "../student-replies";
import { answeredElsewhere, type ActionHandler } from "./handler";

// "Done, next step" on the studentaid.gov guided steps (spec step 114): marks the step done
// and turns the message into the next one, with its official link.
export const studentNext: ActionHandler = {
  id: "student.next",
  on: "open",
  async run({ userId, message, action, client }) {
    // The step this message shows (an older message names it in its text), so one tap marks one
    // step: a second tap, or one from a stale tab, is answered elsewhere.
    const shown = message.refs.studentStep ?? Number(/step (\d+) of/.exec(message.body)?.[1]) - 1;
    let done: number;
    try {
      done = await markStudentStep(userId, {
        client,
        ...(Number.isInteger(shown) && shown >= 0 ? { from: shown } : {}),
      });
    } catch (error) {
      if (error instanceof StudentProfileError) throw answeredElsewhere(error.message);
      throw error;
    }
    const next = stepMessage(done);
    const finished = !next.actions.some((a) => a.id === "student.next");
    return {
      status: finished ? "answered" : "open",
      body: next.body,
      answeredWith: finished ? action.label : null,
      actions: next.actions,
      refs: { ...message.refs, studentStep: next.refs.studentStep },
    };
  },
};
