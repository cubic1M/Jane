"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";

// A page that broke: never a blank screen. One the server never saw (it broke in the browser) is
// told to /admin/errors, scrubbed of anything typed; the server logs its own (instrumentation).
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const path = usePathname();
  useEffect(() => {
    if (error.digest) return;
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: error.name, message: error.message, stack: error.stack, path }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error, path]);
  return (
    <ErrorScreen
      title="Something went wrong"
      words="This page hit a problem on our side. Your data is safe. Try again, or go back to Home."
      from={path}
      retry={
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-full border border-zinc-900 px-5 font-semibold dark:border-zinc-100"
        >
          Try again
        </button>
      }
    />
  );
}
