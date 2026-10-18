"use client";

import { useFormStatus } from "react-dom";
import { answerAll } from "./actions";

function Submit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
    >
      {pending ? "Approving…" : `Yes to all ${count}`}
    </button>
  );
}

export function YesToAll({ items }: { items: { findingId: string; cardHash: string }[] }) {
  return (
    <form action={answerAll}>
      {items.map((i) => (
        <input key={i.findingId} type="hidden" name="item" value={`${i.findingId}:${i.cardHash}`} />
      ))}
      <Submit count={items.length} />
    </form>
  );
}
