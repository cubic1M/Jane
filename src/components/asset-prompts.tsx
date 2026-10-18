import Link from "next/link";
import { promptHref, type AssetPrompt } from "@/lib/owned-assets";

// "Add your home's value to see your equity" (spec step 67), on /loans and /net-worth, for
// a mortgage or car loan with nothing linked to it. Opens the form prefilled; Jane never
// fills in a value.
export function AssetPrompts({ prompts }: { prompts: AssetPrompt[] }) {
  if (prompts.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {prompts.map((p) => (
        <li
          key={p.loanId}
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm [overflow-wrap:anywhere] dark:border-emerald-900 dark:bg-emerald-950"
        >
          <Link
            href={promptHref(p)}
            className="font-medium text-emerald-800 hover:underline dark:text-emerald-200"
          >
            {p.text}
          </Link>
          <span className="text-zinc-600 dark:text-zinc-400"> ({p.loanName})</span>
        </li>
      ))}
    </ul>
  );
}
