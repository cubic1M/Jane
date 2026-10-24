import { dependantsWords } from "@/planning/tax-profile";
import { confirmDependants } from "./actions";
import { SubmitButton } from "@/components/submit-button";

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
      <SubmitButton className="h-11 self-start rounded-lg bg-zinc-900 px-4 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-300">
        Yes, these are my dependants
      </SubmitButton>
    </form>
  );
}
