"use client";

import { useActionState } from "react";
import { readMenu, type ReadState } from "./actions";

export function ReadForm() {
  const [state, action, pending] = useActionState<ReadState, FormData>(readMenu, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="menu-text" className="flex flex-col gap-1 text-sm font-medium">
        Paste your plan&apos;s fee disclosure or the fund list from your statement
        <textarea
          id="menu-text"
          name="text"
          rows={8}
          className="min-w-0 rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
          placeholder="KTSIX  Keystone Total US Stock Index Fund  0.03%  US stock"
        />
      </label>
      {state && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Read it
      </button>
    </form>
  );
}
