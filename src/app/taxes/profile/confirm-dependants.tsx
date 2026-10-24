import { dependantsWords } from "@/planning/tax-profile";
import { confirmDependants } from "./actions";

// One tap on the dependants Jane found (the children in the household listed for insurance).

export function ConfirmDependants({
  childrenUnder17,
  otherDependants,
  from,
}: {
  childrenUnder17: number;
  otherDependants: number;
  from: string;
}) {
  return (
    <form action={confirmDependants} className="flex flex-col gap-2 text-sm">
      <p>
        Found by Jane: {dependantsWords(childrenUnder17, otherDependants)}, from {from}. Are these
        your dependants?
      </p>
      <button
        type="submit"
        className="h-11 self-start rounded-lg bg-emerald-700 px-4 font-medium text-white hover:bg-emerald-800"
      >
        Yes, these are my dependants
      </button>
    </form>
  );
}
