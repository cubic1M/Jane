import { markStudentStep } from "@/lib/student-loans";
import { stepMessage } from "../student-replies";
import type { ActionHandler } from "./handler";

// "Done, next step" on the studentaid.gov guided steps (spec step 114): marks the step done
// and turns the message into the next one, with its official link.
export const studentNext: ActionHandler = {
  id: "student.next",
  on: "open",
  async run({ userId, action, client }) {
    const done = await markStudentStep(userId, { client });
    const next = stepMessage(done);
    const finished = !next.actions.some((a) => a.id === "student.next");
    return {
      status: finished ? "answered" : "open",
      body: next.body,
      answeredWith: finished ? action.label : null,
      actions: next.actions,
    };
  },
};
